import { decodePng, type DecodedImage } from './vitest-decode-png';

// happy-dom lacks ElementInternals, but Web Awesome reads validity as its controls connect.
if (!HTMLElement.prototype.attachInternals) {
  HTMLElement.prototype.attachInternals = function attachInternals(this: HTMLElement) {
    return {
      form: null,
      labels: [] as unknown as NodeList,
      states: new Set<string>(),
      validationMessage: '',
      validity: { valid: true } as ValidityState,
      willValidate: false,
      checkValidity: () => true,
      reportValidity: () => true,
      setFormValue: () => {},
      setValidity: () => {},
    } as unknown as ElementInternals;
  };
}

// Finish animations immediately so details controls settle without a browser animation engine.
if (!Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    return { finished: Promise.resolve(), cancel: () => {}, finish: () => {} } as unknown as Animation;
  };
}

// Provide enough image and canvas support to decode the real colormap sprite in happy-dom.
class TestImageData {
  readonly colorSpace = 'srgb';

  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class TestImageBitmap {
  constructor(readonly image: DecodedImage) {}
  get width() {
    return this.image.width;
  }
  get height() {
    return this.image.height;
  }
  close() {}
}

class TestCanvasContext {
  constructor(private readonly canvas: TestOffscreenCanvas) {}

  // Only opaque, unscaled images on a blank canvas are supported by this test surface.
  drawImage(bitmap: TestImageBitmap, dx = 0, dy = 0) {
    const { width, height, data } = bitmap.image;
    for (let y = 0; y < height; y++) {
      const row = dy + y;
      if (row < 0 || row >= this.canvas.height) continue;
      for (let x = 0; x < width; x++) {
        const column = dx + x;
        if (column < 0 || column >= this.canvas.width) continue;
        const from = (y * width + x) * 4;
        this.canvas.pixels.set(data.subarray(from, from + 4), (row * this.canvas.width + column) * 4);
      }
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): TestImageData {
    const data = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      const from = ((sy + y) * this.canvas.width + sx) * 4;
      data.set(this.canvas.pixels.subarray(from, from + sw * 4), y * sw * 4);
    }
    return new TestImageData(data, sw, sh);
  }
}

class TestOffscreenCanvas {
  readonly pixels: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(contextId: string): TestCanvasContext | null {
    return contextId === '2d' ? new TestCanvasContext(this) : null;
  }
}

if (!globalThis.ImageData) globalThis.ImageData = TestImageData as unknown as typeof ImageData;
if (!globalThis.ImageBitmap) globalThis.ImageBitmap = TestImageBitmap as unknown as typeof ImageBitmap;
if (!globalThis.OffscreenCanvas) globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;

if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = (async (source: Blob | ArrayBuffer | ArrayBufferView) => {
    if (source instanceof Blob) return new TestImageBitmap(decodePng(new Uint8Array(await source.arrayBuffer())));
    if (source instanceof ArrayBuffer) return new TestImageBitmap(decodePng(new Uint8Array(source)));
    if (ArrayBuffer.isView(source)) return new TestImageBitmap(decodePng(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)));
    throw new TypeError('The test DOM can only make an ImageBitmap out of encoded bytes.');
  }) as typeof createImageBitmap;
}

const crossOrigin = (url: string | URL): boolean => {
  try {
    const resolved = new URL(String(url), window.location.href);
    if (resolved.protocol === 'data:') return false;
    return resolved.origin !== window.location.origin;
  } catch {
    return false;
  }
};

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' || input instanceof URL ? input : input.url;
  return crossOrigin(url) ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(input, init);
}) as typeof globalThis.fetch;

const blocked = new WeakMap<XMLHttpRequest, string>();
const realOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  if (crossOrigin(url)) blocked.set(this, String(url));
  else blocked.delete(this);
  return realOpen.call(this, method, url, ...(rest as []));
};

const realSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const url = blocked.get(this);
  if (url) throw new DOMException(`Blocked a request to "${url}": the test DOM has no server behind it.`, 'NetworkError');
  return realSend.call(this, body);
};

export {};
