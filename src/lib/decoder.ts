import { DecoderPool, type DecodedPixels, type DecoderPoolOptions } from '@developmentseed/geotiff';

import { DECODER_WORKER_SOURCE } from './decoder-worker-source';

// How many workers decode tiles. deck.gl asks for a viewport's worth at once, so more than one is
// worth having, but it also throttles itself to six tile requests at a time - so a pool much bigger
// than that could never be busy. A fixed number rather than navigator.hardwareConcurrency, which is
// what upstream's default pool uses: every worker is another copy of the decoders, wasm included, and
// a machine reporting sixteen cores has no more COG in front of it than one reporting four.
const POOL_SIZE = 4;

// How long the first tile has to come back from a worker before the pool gives up on workers
// altogether. Only ever waited out when something is wrong - a worker that runs at all answers in
// milliseconds - so it is set to be unmistakable rather than tight. See FallbackDecoderPool.
const FIRST_DECODE_TIMEOUT = 10_000;

// The arguments and answer of a decode, taken from the pool itself rather than named here: the
// compression is @cogeotiff/core's enum, which this library doesn't depend on directly.
type DecodeArguments = Parameters<DecoderPool['decode']>;

// Starts a decoder worker from source held in this bundle, rather than from a file of its own.
//
// A worker has to be same-origin, and this library is usually not: GeoBlacklight and sul-embed both
// load it from a CDN through an importmap, so a worker built from a URL beside this module would be
// refused outright (SecurityError, thrown by the constructor). A blob is same-origin wherever the
// page is, which is how MapLibre and Allmaps already start their own workers in this bundle - so the
// one Content-Security-Policy this needs, `worker-src blob:`, is one the viewer already needs.
//
// Inlining the source rather than fetching it from the CDN buys the rest: no CORS to satisfy, no
// second chance for the network to fail long after the page loaded, and nothing for a consumer's
// bundler to resolve - which is the other half of why the URL upstream builds is a problem (#186).
//
// Revoked immediately, as Vite's own inlined workers do: the constructor has already resolved the
// URL by the time it returns, and holding it would keep a copy of the source alive per worker.
function createDecoderWorker(source: string): Worker {
  const url = decoderWorkerUrl(source);

  try {
    return new Worker(url, { type: 'module' });
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

// Where the worker's source is handed to the browser from. A blob, except in a document that has no
// origin for one to inherit - a sandboxed iframe, which is how sul-embed is embedded - where Chromium
// refuses a module worker from a blob URL however self-contained it is. A data: URL is allowed there,
// so the blob URL naming a null origin is the signal to use one; Allmaps' worker in this same bundle
// keeps that pair the other way round. Only worth the longer URL where the shorter one cannot work:
// a policy is far likelier to allow blob: in worker-src than data:.
function decoderWorkerUrl(source: string): string {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  if (!url.startsWith('blob:null')) return url;

  URL.revokeObjectURL(url);
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

// A pool that decodes in place if its workers turn out not to work.
//
// The ways they can fail are narrow, since they are built from source that is already here: a policy
// that refuses blob: workers refuses them in the constructor, and a browser with no Worker at all
// never builds this pool. But narrow is not none, and the failure that isn't a thrown error is the
// bad one - a worker that dies on load answers nothing, and DecoderPool's job never settles, so
// every tile of that COG would sit unfinished with nothing said about why.
//
// So the first tile through the pool is raced against the workers reporting themselves broken and
// against a deadline, and a race that doesn't come back takes the workers out of service. The tile
// itself is still drawn, from the copy kept for that purpose. Once one tile has come back the copy
// and the deadline are dropped: the workers have answered, and a pool that keeps second-guessing them
// would be paying for a copy of every tile it ever decodes.
//
// Later tiles are given up on rather than retried, but they are still given up on: a worker that dies
// mid-session - a decode that runs the tab out of memory - leaves the job it was given pending for
// good, and deck.gl throttles its tile requests, so six unfinished ones and the layer stops asking
// for tiles at all. Losing the tile a dead worker was decoding is the better end of that trade.
class FallbackDecoderPool extends DecoderPool {
  private proven = false;

  // The decodes waiting on a worker right now. DecoderPool never settles the job a terminated worker
  // was holding, so these are the promises that would hang; they are failed by hand instead. Held as
  // a set so each one is dropped as it finishes, rather than accumulating for the life of the pool.
  private readonly waiting = new Set<(error: unknown) => void>();

  constructor(broken: Promise<never>, options: DecoderPoolOptions) {
    super(options);
    // However late the news arrives, and whether or not a tile is waiting on one right now
    broken.catch(error => this.retire(error));
  }

  async decode(...args: DecodeArguments): Promise<DecodedPixels> {
    if (!this.hasWorkers) return await super.decode(...args);
    if (this.proven) return await this.decodeInWorker(args);

    // The pool hands the compressed bytes to a worker by transferring them, which detaches the
    // buffer here - so the copy has to be taken before the attempt, not after it fails.
    const [bytes, ...rest] = args;
    const retry = bytes.slice(0);

    let deadline: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`No answer from a decoder worker in ${FIRST_DECODE_TIMEOUT}ms`)), FIRST_DECODE_TIMEOUT);
    });

    try {
      const pixels = await Promise.race([this.decodeInWorker(args), expiry]);
      this.proven = true;
      return pixels;
    } catch (error) {
      this.retire(error);
      return await super.decode(retry, ...rest);
    } finally {
      clearTimeout(deadline);
    }
  }

  private async decodeInWorker(args: DecodeArguments): Promise<DecodedPixels> {
    let abandon: (error: unknown) => void = () => {};
    const abandoned = new Promise<never>((_, reject) => this.waiting.add((abandon = reject)));

    try {
      return await Promise.race([super.decode(...args), abandoned]);
    } finally {
      this.waiting.delete(abandon);
    }
  }

  // Take the workers out of service, so every later tile decodes on the main thread: destroy() is
  // what turns hasWorkers off, and the pool's own decode() reads that as "decode in place". Said
  // once however many tiles were waiting on the same broken workers.
  private retire(error: unknown) {
    if (!this.hasWorkers) return;

    console.warn('Could not decode COG tiles in a worker, so decoding them on the main thread instead:', error);
    this.destroy();
    this.waiting.forEach(abandon => abandon(error));
  }
}

// Builds a pool that decodes off the main thread, or one that decodes on it when there is no way not
// to: a build that didn't inline the worker (the unit tests, which read this module as written), or
// an environment with no Worker at all (Node, and happy-dom - so the tests that load the built
// output don't try to start one either).
export function createDecoderPool(source: string = DECODER_WORKER_SOURCE, size: number = POOL_SIZE): DecoderPool {
  if (!source || typeof Worker === 'undefined') return new DecoderPool({ createWorker: undefined });

  // Rejects as soon as any worker reports it can't run, which is what takes the pool's workers out
  // of service. Marked handled here as well as there, because a pool that couldn't be built at all is
  // thrown away below - and a rejection nothing is listening to is reported as an unhandled one.
  let reportBroken: (error: unknown) => void = () => {};
  const broken = new Promise<never>((_, reject) => (reportBroken = reject));
  broken.catch(() => {});

  const started: Worker[] = [];
  const createWorker = () => {
    const worker = createDecoderWorker(source);
    worker.addEventListener('error', event => reportBroken(new Error(`A decoder worker could not start: ${event.message || 'no reason given'}`)));
    worker.addEventListener('messageerror', () => reportBroken(new Error('A decoder worker sent something that could not be read')));
    started.push(worker);
    return worker;
  };

  try {
    return new FallbackDecoderPool(broken, { size, createWorker });
  } catch (error) {
    // The likeliest way a worker is refused, and the one FallbackDecoderPool can't help with: a
    // Content-Security-Policy without `worker-src blob:` throws here rather than reporting an event,
    // and it throws while the pool is being built - so with nothing caught, the whole preview would
    // fail over a decoder that only makes it faster. Anything already started is stopped, since the
    // pool that would have owned them is being thrown away.
    started.forEach(worker => worker.terminate());
    console.warn('Could not start the decoder workers, so COG tiles will be decoded on the main thread:', error);
    return new DecoderPool({ createWorker: undefined });
  }
}

// One pool for every COG drawn on the page, built the first time one is.
//
// Shared because the alternative is a pool per preview, and previews outlive their use: a record
// change builds new ones without tearing the old ones down, and a page can hold more than one
// <ogm-viewer>. Each would otherwise arrive with POOL_SIZE workers of its own and keep them.
//
// Never destroyed, which is also what upstream's default pool does. There is nowhere to do it from -
// clearPreview() is only reached when an app swaps the previewer on a live <ogm-map>, not on the
// <ogm-viewer> path - and nowhere it would be right to: destroy() strands whatever job its workers
// were holding, and previews are attached again constantly, since every theme change rebuilds the
// style document and draws each of them from scratch.
let shared: DecoderPool | undefined;

export function decoderPool(): DecoderPool {
  shared ??= createDecoderPool();
  return shared;
}
