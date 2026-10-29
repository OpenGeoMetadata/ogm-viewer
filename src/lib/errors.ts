export class PreviewError extends Error {
  title: string;

  url?: string;

  fatal?: boolean;
}

class RecordLoadError extends PreviewError {
  title = "This record couldn't be loaded";

  constructor(status: number, url: string) {
    super(`The record URL responded with an error (HTTP ${status}). Check that the URL is correct and the record is publicly available.`);
    this.url = url;
  }
}

class RecordNetworkError extends PreviewError {
  title = "This record couldn't be reached";

  constructor(url: string) {
    super('The server may be unreachable, or it may be blocking cross-origin (CORS) requests from this page.');
    this.url = url;
  }
}

class RecordParseError extends PreviewError {
  title = "This record couldn't be parsed";

  constructor(url: string) {
    super("The record URL didn't return valid JSON metadata. It may be pointing at an HTML page or a malformed file.");
    this.url = url;
  }
}

class RecordReadError extends PreviewError {
  title = "This record couldn't be read";

  constructor(message: string, url: string) {
    super(message);
    this.url = url;
  }
}

class ReferenceLoadError extends PreviewError {
  constructor(refType: string, status: number, url?: string) {
    super(`The reference URL responded with an error (HTTP ${status}). Check that the URL is correct and the reference is publicly available.`);
    this.title = `The ${refType} preview couldn't be loaded`;
    this.url = url;
  }
}

class ReferenceNetworkError extends PreviewError {
  constructor(refType: string, url?: string) {
    super('The server may be unreachable, or it may be blocking cross-origin (CORS) requests from this page.');
    this.title = `The ${refType} preview couldn't be reached`;
    this.url = url;
  }
}

class ReferenceReadError extends PreviewError {
  constructor(refType: string, message: string, url?: string) {
    super(message);
    this.title = `The ${refType} preview couldn't be read`;
    this.url = url;
  }
}

class ReferenceTimeoutError extends PreviewError {
  constructor(refType: string, url?: string) {
    super('Data failed to load in time. The server may be unreachable or overloaded, or it may not hold the requested data.');
    this.title = `The ${refType} preview timed out`;
    this.url = url;
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Gave up waiting for ${what} after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(url: string, status: number, statusText: string) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

export class WebGLUnavailableError extends PreviewError {
  title = "This record couldn't be displayed";
  fatal = true;

  constructor() {
    super('WebGL is not available for this browser or device.');
    this.name = 'WebGLUnavailableError';
  }
}

export async function fetchOrThrow(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new HttpError(url, response.status, response.statusText);
  return response;
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 ? status : undefined;
}

// MapLibre uses status 0 for network failures; fetch reports them as TypeError.
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (error as { status?: unknown } | null)?.status === 0;
}

export function isWebGLError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Failed to initialize WebGL');
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

export function recordError(error: unknown, url: string): PreviewError {
  const status = statusOf(error);
  const message = messageOf(error);

  if (isNetworkError(error)) return new RecordNetworkError(url);

  if (status !== undefined) return new RecordLoadError(status, url);

  if (error instanceof SyntaxError) return new RecordParseError(url);

  return new RecordReadError(message ?? 'An unknown error occurred while reading this record.', url);
}

export function referenceError(error: unknown, refType: string, url?: string): PreviewError {
  const status = statusOf(error);
  const message = messageOf(error);

  if (error instanceof TimeoutError) return new ReferenceTimeoutError(refType, url);

  if (isNetworkError(error)) return new ReferenceNetworkError(refType, url);

  if (status !== undefined) return new ReferenceLoadError(refType, status, url);

  return new ReferenceReadError(refType, message ?? 'An unknown error occurred while reading this reference.', url);
}
