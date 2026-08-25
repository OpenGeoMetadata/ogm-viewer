import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { DECODER_REGISTRY } from '@developmentseed/geotiff';

import { createDecoderPool, decoderPool } from './decoder';

// Enough of a Worker for DecoderPool, which only ever adds a message listener, posts a job and
// terminates - and for createDecoderPool, which also listens for the two failures a worker reports as
// events. Records what it was built with, and lets a test answer or fail a job on its behalf.
class StubWorker {
  static built: { url: string; type?: string }[] = [];

  private listeners = new Map<string, ((event: unknown) => void)[]>();
  posted: unknown[] = [];
  terminated = false;

  constructor(url: string | URL, options?: WorkerOptions) {
    StubWorker.built.push({ url: String(url), type: options?.type });
    StubWorker.last = this;
  }

  static last: StubWorker | undefined;

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  // Answer the job just posted, as the real worker's handler would
  answer(pixels: unknown) {
    const { jobId } = this.posted[this.posted.length - 1] as { jobId: number };
    this.emit('message', { data: { jobId, pixels } });
  }

  emit(type: string, event: unknown) {
    (this.listeners.get(type) ?? []).forEach(listener => listener(event));
  }
}

// One 2x2 tile of uncompressed 8-bit samples: Compression.None, so the main thread can decode it
// without a codec, which is what makes the fallback checkable rather than only observable.
const TILE_METADATA = { width: 2, height: 2, bitsPerSample: 8, samplesPerPixel: 1, planarConfiguration: 1, predictor: 1, sampleFormat: 1 };
const UNCOMPRESSED = 1;
const tile = () => new Uint8Array([1, 2, 3, 4]).buffer;

// The bundled worker, as stencil.config.ts inlines it. Never run: every test here stubs Worker.
const SOURCE = 'self.addEventListener("message", () => {})';

// LERC's TIFF compression tag, and whatever upstream had registered against it before this file
// built a pool - read now, because building one is what replaces it.
const LERC_COMPRESSION = 34887;
const UPSTREAM_LERC_CODEC = DECODER_REGISTRY.get(LERC_COMPRESSION);

const withWorkers = (size = 2) => {
  vi.stubGlobal('Worker', StubWorker);
  return createDecoderPool(SOURCE, size);
};

afterEach(() => {
  // console.warn is spied on more than once here, and vitest hands back the same spy when a method
  // is already mocked - so without this the calls of one test are the calls of the next.
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  StubWorker.built = [];
  StubWorker.last = undefined;
});

describe('createDecoderPool', () => {
  it('decodes in workers, which is the whole point of it', () => {
    const pool = withWorkers(3);

    expect(pool.hasWorkers).toBe(true);
    expect(StubWorker.built).toHaveLength(3);
  });

  // A worker has to be same-origin, and this library is usually loaded from a CDN, so its source
  // travels in the bundle and the worker is started from a blob of it. See decoder.ts.
  it('starts each worker from a blob of the inlined source, as a module', () => {
    withWorkers(1);

    expect(StubWorker.built[0].url).toMatch(/^blob:/);
    expect(StubWorker.built[0].type).toEqual('module');
  });

  // lerc looks for its own wasm beside whichever chunk it was bundled into, which is nowhere; the
  // pool is what tells it otherwise, for its own thread as much as for its workers. Read as "not the
  // loader upstream registered" rather than by calling it, because calling it would instantiate a
  // WebAssembly module - and captured at import time, since the first pool any test builds is what
  // replaces it. See locateLercWasm in ./lerc.
  it('tells lerc where its wasm is, so a LERC tile can be decoded here too', () => {
    vi.stubGlobal('Worker', StubWorker);

    createDecoderPool(SOURCE, 1);

    expect(DECODER_REGISTRY.get(LERC_COMPRESSION)).not.toBe(UPSTREAM_LERC_CODEC);
    expect(DECODER_REGISTRY.get(LERC_COMPRESSION)).toBeInstanceOf(Function);
  });

  it('decodes on the main thread when the build inlined no worker', () => {
    vi.stubGlobal('Worker', StubWorker);

    expect(createDecoderPool('').hasWorkers).toBe(false);
    expect(StubWorker.built).toEqual([]);
  });

  // Node, and happy-dom - so the tests that load the built output don't try to start one either
  it('decodes on the main thread where there is no Worker at all', () => {
    vi.stubGlobal('Worker', undefined);

    expect(createDecoderPool(SOURCE).hasWorkers).toBe(false);
  });

  // The likeliest refusal in the wild, and the one that arrives as a thrown error rather than an
  // event: a Content-Security-Policy with no `worker-src blob:`. Uncaught it would fail the preview
  // over a decoder that only makes it faster.
  it('decodes on the main thread when the page refuses to start a worker at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('Refused to create a worker from blob:', 'SecurityError');
        }
      },
    );

    expect(createDecoderPool(SOURCE).hasWorkers).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('decoded on the main thread');
  });

  it('hands a tile to a worker and gives back what it answers', async () => {
    const pool = withWorkers(1);
    const decoded = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);

    StubWorker.last!.answer({ layout: 'pixel-interleaved', data: new Uint8Array([9, 9, 9, 9]) });

    expect(((await decoded) as { data: Uint8Array }).data).toEqual(new Uint8Array([9, 9, 9, 9]));
    expect(pool.hasWorkers).toBe(true);
  });

  // The failure worth guarding against: a worker that can't start answers nothing at all, so the
  // job it was given would never settle and the tile would never be drawn. The tile is decoded in
  // place instead, from the copy taken before the bytes were transferred away.
  it('draws the tile on the main thread when a worker cannot start', async () => {
    const pool = withWorkers(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);

    StubWorker.last!.emit('error', { message: 'Refused to create a worker from blob:' });

    expect(((await decoded) as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(warn.mock.calls[0][0]).toContain('decoding them on the main thread instead');
  });

  // And every tile after it, rather than each one paying for the same discovery again
  it('stops using the workers once they have failed once', async () => {
    const pool = withWorkers(1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);
    StubWorker.last!.emit('error', {});
    await decoded;

    expect(pool.hasWorkers).toBe(false);
    expect(StubWorker.last!.terminated).toBe(true);

    const posted = StubWorker.last!.posted.length;
    const next = await pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);

    expect((next as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(StubWorker.last!.posted).toHaveLength(posted);
  });

  // A worker that dies with a job in flight never answers it, and the pool leaves that job pending
  // for good: deck.gl throttles tile requests, so six of those and the layer stops asking for tiles
  // at all. Failing the tile is what keeps the layer loading.
  it('fails a tile rather than leaving it pending when a worker dies mid-session', async () => {
    const pool = withWorkers(1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);
    StubWorker.last!.answer({ layout: 'pixel-interleaved', data: new Uint8Array([9]) });
    await first;

    const lost = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);
    StubWorker.last!.emit('error', { message: 'out of memory' });

    await expect(lost).rejects.toThrow('could not start');
    expect(pool.hasWorkers).toBe(false);

    // And the next tile is decoded here instead of asking the workers that just died
    expect(((await pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never)) as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  // A document with an opaque origin - a sandboxed iframe, which is how sul-embed is embedded - has
  // no origin for a blob URL to inherit, and Chromium refuses a module worker from one of those.
  it('starts the worker from a data URL where a blob has no origin to inherit', () => {
    vi.stubGlobal('Worker', StubWorker);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:null/4a1c-0000');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    createDecoderPool(SOURCE, 1);

    expect(StubWorker.built[0].url).toEqual(`data:text/javascript;charset=utf-8,${encodeURIComponent(SOURCE)}`);
    expect(StubWorker.built[0].type).toEqual('module');
    // The blob that couldn't be used is let go rather than left holding a copy of the source
    expect(revoke).toHaveBeenCalledWith('blob:null/4a1c-0000');
  });

  // A worker that starts and then says nothing is the same problem arriving more slowly
  it('gives up on a worker that never answers', async () => {
    vi.useFakeTimers();
    const pool = withWorkers(1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const decoded = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(((await decoded) as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(pool.hasWorkers).toBe(false);
  });
});

describe('decoderPool', () => {
  // A results page draws an overview map per record, and a record can offer more than one COG. A
  // pool each would be a page with a multiple of the pool size in workers on it.
  it('is one pool for every COG on the page', () => {
    expect(decoderPool()).toBe(decoderPool());
  });
});
