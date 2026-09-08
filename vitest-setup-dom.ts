// What any of our components need of the DOM they are tested in, whichever build they came out of:
// the gaps happy-dom leaves, and a guarantee that nothing under test reaches the network. Shared by
// the component project (vitest-setup.ts, which drives dist/components) and the www project (which
// drives the built lazy bundle), since neither concern has anything to do with the output target.
import { decodePng, type DecodedImage } from './vitest-decode-png';

// Enough of ElementInternals for Web Awesome's form controls to upgrade. happy-dom implements none
// of it (checked in 20.9), and <wa-button> reads validity out of it as it connects, so without this
// every component that renders one throws before its own markup exists to assert on. Nothing here
// is exercised by a test - it only has to not be undefined. Form behavior is Web Awesome's to test.
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

// Enough of the image pipeline to turn encoded bytes into pixels, which happy-dom has none of
// (checked in 20.9): no ImageData, no ImageBitmap, no createImageBitmap, no OffscreenCanvas. Two of
// those are what @developmentseed/deck.gl-raster's decodeColormapSprite reaches for, so without
// them every ogm-layers and ogm-legend render in the suite fell into the catch around
// colormapSprite() - a warning per component, and swatches and legend bars that never carried a
// gradient to assert on. With these the sprite decodes the way it does in a browser, so those tests
// see the real ramps. Unlike the ElementInternals stub above, this is exercised: the colors that
// come out of it are what src/components/ogm-legend/ogm-legend.test.tsx checks.
//
// The decoding itself is vitest-decode-png.ts. What's here is only the browser-shaped surface over
// it, and only as much of that surface as anything under test touches - a canvas that is drawn to
// once and read back whole, not a renderer.
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

  // Replaces rather than composites: every source this sees is an opaque image landing on a blank
  // canvas, where the two are the same thing. Scaling isn't supported - only the (image, dx, dy)
  // form of drawImage, which is the one that needs no resampling to be honest about.
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

// Only the source types a caller here actually passes. A Blob is what decodeColormapSprite wraps
// its bytes in; the raw forms are accepted too, since a test that hands over bytes directly means
// the same thing by it. Anything else - a canvas, a video frame - would need real rendering behind
// it, so it says so rather than decoding whatever it can reach.
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = (async (source: Blob | ArrayBuffer | ArrayBufferView) => {
    if (source instanceof Blob) return new TestImageBitmap(decodePng(new Uint8Array(await source.arrayBuffer())));
    if (source instanceof ArrayBuffer) return new TestImageBitmap(decodePng(new Uint8Array(source)));
    if (ArrayBuffer.isView(source)) return new TestImageBitmap(decodePng(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)));
    throw new TypeError('The test DOM can only make an ImageBitmap out of encoded bytes.');
  }) as typeof createImageBitmap;
}

// Used to intercept requests for fixture data in tests
const crossOrigin = (url: string | URL): boolean => {
  try {
    const resolved = new URL(String(url), window.location.href);
    // Every icon in the library is a data URL - see registerIconLibrary in src/lib/init.ts. Nothing
    // leaves the page for one, so there is nothing here to block, and its origin reads as null.
    if (resolved.protocol === 'data:') return false;
    return resolved.origin !== window.location.origin;
  } catch {
    return false;
  }
};

// Auto-reject cross-origin fetch requests to keep the test DOM off the network
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' || input instanceof URL ? input : input.url;
  return crossOrigin(url) ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(input, init);
}) as typeof globalThis.fetch;

// Same thing but for XMLHttpRequest; we check at open() and block at send()
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
