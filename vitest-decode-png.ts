// Decode only non-interlaced 8-bit RGB/RGBA PNGs, the format used by the test colormap sprite.
import { inflateSync } from 'node:zlib';

export type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const BYTES_PER_PIXEL: Record<number, number> = { 2: 3, 6: 4 };

// PNG row filters: https://www.w3.org/TR/png/#9Filters
function reconstruct(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const predicted = left + up - upLeft;
      const fromLeft = Math.abs(predicted - left);
      const fromUp = Math.abs(predicted - up);
      const fromUpLeft = Math.abs(predicted - upLeft);
      if (fromLeft <= fromUp && fromLeft <= fromUpLeft) return left;
      return fromUp <= fromUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`Unsupported PNG: scanline filter ${filter}.`);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  if (SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('Not a PNG: the bytes do not start with a PNG signature.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const compressed: Uint8Array[] = [];

  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      const depth = body[8];
      const colorType = body[9];
      const interlaced = body[12] !== 0;
      if (depth !== 8 || interlaced || !(colorType in BYTES_PER_PIXEL)) {
        throw new Error(`Unsupported PNG: ${depth}-bit color type ${colorType}${interlaced ? ', interlaced' : ''}. This decoder handles 8-bit truecolor only.`);
      }
      bytesPerPixel = BYTES_PER_PIXEL[colorType];
    } else if (type === 'IDAT') {
      compressed.push(body);
    }

    offset += 12 + length;
  }

  if (!width || !height || !compressed.length) throw new Error('Unsupported PNG: no image data.');

  const raw = inflateSync(concat(compressed));
  const stride = width * bytesPerPixel;
  const data = new Uint8ClampedArray(width * height * 4);
  let line = new Uint8Array(stride);
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];

    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? line[x - bytesPerPixel] : 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      line[x] = (raw[start + 1 + x] + reconstruct(filter, left, previous[x], upLeft)) & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const from = x * bytesPerPixel;
      const to = (y * width + x) * 4;
      data[to] = line[from];
      data[to + 1] = line[from + 1];
      data[to + 2] = line[from + 2];
      data[to + 3] = bytesPerPixel === 4 ? line[from + 3] : 255;
    }

    [line, previous] = [previous, line];
  }

  return { width, height, data };
}
