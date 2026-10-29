import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { DECODER_REGISTRY } from '@developmentseed/geotiff';

import { createDecoderPool, decoderPool } from './decoder';

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

  answer(pixels: unknown) {
    const { jobId } = this.posted[this.posted.length - 1] as { jobId: number };
    this.emit('message', { data: { jobId, pixels } });
  }

  emit(type: string, event: unknown) {
    (this.listeners.get(type) ?? []).forEach(listener => listener(event));
  }
}

const TILE_METADATA = { width: 2, height: 2, bitsPerSample: 8, samplesPerPixel: 1, planarConfiguration: 1, predictor: 1, sampleFormat: 1 };
const UNCOMPRESSED = 1;
const tile = () => new Uint8Array([1, 2, 3, 4]).buffer;

const SOURCE = 'self.addEventListener("message", () => {})';

const LERC_COMPRESSION = 34887;
const UPSTREAM_LERC_CODEC = DECODER_REGISTRY.get(LERC_COMPRESSION);

const withWorkers = (size = 2) => {
  vi.stubGlobal('Worker', StubWorker);
  return createDecoderPool(SOURCE, size);
};

afterEach(() => {
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

  it('starts each worker from a blob of the inlined source, as a module', () => {
    withWorkers(1);

    expect(StubWorker.built[0].url).toMatch(/^blob:/);
    expect(StubWorker.built[0].type).toEqual('module');
  });

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

  it('decodes on the main thread where there is no Worker at all', () => {
    vi.stubGlobal('Worker', undefined);

    expect(createDecoderPool(SOURCE).hasWorkers).toBe(false);
  });

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

  it('draws the tile on the main thread when a worker cannot start', async () => {
    const pool = withWorkers(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never);

    StubWorker.last!.emit('error', { message: 'Refused to create a worker from blob:' });

    expect(((await decoded) as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(warn.mock.calls[0][0]).toContain('decoding them on the main thread instead');
  });

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

    expect(((await pool.decode(tile(), UNCOMPRESSED, TILE_METADATA as never)) as { data: Uint8Array }).data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('starts the worker from a data URL where a blob has no origin to inherit', () => {
    vi.stubGlobal('Worker', StubWorker);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:null/4a1c-0000');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    createDecoderPool(SOURCE, 1);

    expect(StubWorker.built[0].url).toEqual(`data:text/javascript;charset=utf-8,${encodeURIComponent(SOURCE)}`);
    expect(StubWorker.built[0].type).toEqual('module');
    expect(revoke).toHaveBeenCalledWith('blob:null/4a1c-0000');
  });

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
  it('is one pool for every COG on the page', () => {
    expect(decoderPool()).toBe(decoderPool());
  });
});
