// A PNG decoder for the test DOM, which has no image pipeline of its own - see vitest-setup-dom.ts
// for what this is wired into and why. Node has the inflate half of the job built in; the rest is
// the scanline filtering PNG applies on top of it.
//
// Deliberately narrow: 8-bit truecolor, not interlaced, which is what the one image the components
// decode is - the color ramp sprite behind src/lib/colormap.ts. Anything else throws rather than
// returning plausible-looking pixels, so a test that starts decoding some other image fails saying
// so instead of asserting against garbage.
import { inflateSync } from 'node:zlib';

export type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Bytes per pixel for the color types this handles: 2 is RGB, 6 is RGBA. Paletted and grayscale
// PNGs are left out - each needs a decoding step of its own, and nothing here produces one.
const BYTES_PER_PIXEL: Record<number, number> = { 2: 3, 6: 4 };

// Every scanline is filtered against its neighbors before compression, and has to be added back:
// `left` is the pixel before it on the same row, `up` the one above, `upLeft` above that one. See
// https://www.w3.org/TR/png/#9Filters - the four cases below are that table.
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
      // Paeth: whichever neighbor the three of them together predict most closely
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

// Decode to RGBA, one byte per channel, top row first - the layout ImageData wants.
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('Not a PNG: the bytes do not start with a PNG signature.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const compressed: Uint8Array[] = [];

  // Walk the chunk list: a 4-byte length, a 4-byte type, the body, and a CRC that isn't checked -
  // the only files reaching this are ones the repo ships itself.
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
      // Split across as many chunks as the encoder felt like; it's one stream once joined
      compressed.push(body);
    }

    offset += 12 + length;
  }

  if (!width || !height || !compressed.length) throw new Error('Unsupported PNG: no image data.');

  const raw = inflateSync(concat(compressed));
  const stride = width * bytesPerPixel;
  const data = new Uint8ClampedArray(width * height * 4);
  // The row being reconstructed, and the finished one above it that its filter refers back to
  let line = new Uint8Array(stride);
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    // Each scanline is its filter byte followed by `stride` filtered bytes
    const start = y * (stride + 1);
    const filter = raw[start];

    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? line[x - bytesPerPixel] : 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      line[x] = (raw[start + 1 + x] + reconstruct(filter, left, previous[x], upLeft)) & 0xff;
    }

    // Widened to RGBA on the way out, so a caller need not care which of the two color types it got
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
