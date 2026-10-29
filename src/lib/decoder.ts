import { DecoderPool, type DecodedPixels, type DecoderPoolOptions } from '@developmentseed/geotiff';

import { DECODER_WORKER_SOURCE } from './decoder-worker-source';
import { locateLercWasm } from './lerc';

// Limit worker count because each holds its own copy of the decoders and wasm.
const POOL_SIZE = 4;

const FIRST_DECODE_TIMEOUT = 10_000;

type DecodeArguments = Parameters<DecoderPool['decode']>;

// Blob workers inherit the page origin, allowing the library itself to load from a CDN.
function createDecoderWorker(source: string): Worker {
  const url = decoderWorkerUrl(source);

  try {
    return new Worker(url, { type: 'module' });
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

// Chromium requires a data URL for module workers in sandboxed iframes with a null origin.
function decoderWorkerUrl(source: string): string {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  if (!url.startsWith('blob:null')) return url;

  URL.revokeObjectURL(url);
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

// Retry the first failed worker decode locally; reject later stranded jobs and retire the pool.
class FallbackDecoderPool extends DecoderPool {
  private proven = false;

  // DecoderPool leaves terminated jobs pending, so reject them explicitly when workers fail.
  private readonly waiting = new Set<(error: unknown) => void>();

  constructor(broken: Promise<never>, options: DecoderPoolOptions) {
    super(options);
    broken.catch(error => this.retire(error));
  }

  async decode(...args: DecodeArguments): Promise<DecodedPixels> {
    if (!this.hasWorkers) return await super.decode(...args);
    if (this.proven) return await this.decodeInWorker(args);

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

  private retire(error: unknown) {
    if (!this.hasWorkers) return;

    console.warn('Could not decode COG tiles in a worker, so decoding them on the main thread instead:', error);
    this.destroy();
    this.waiting.forEach(abandon => abandon(error));
  }
}

export function createDecoderPool(source: string = DECODER_WORKER_SOURCE, size: number = POOL_SIZE): DecoderPool {
  locateLercWasm();

  if (!source || typeof Worker === 'undefined') return new DecoderPool({ createWorker: undefined });

  // Handle rejection even if pool construction fails before anything starts listening.
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
    started.forEach(worker => worker.terminate());
    console.warn('Could not start the decoder workers, so COG tiles will be decoded on the main thread:', error);
    return new DecoderPool({ createWorker: undefined });
  }
}

// Share one pool across previews and viewers so switching records does not accumulate workers.
let shared: DecoderPool | undefined;

export function decoderPool(): DecoderPool {
  shared ??= createDecoderPool();
  return shared;
}
