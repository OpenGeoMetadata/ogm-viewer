// Supertype for errors thrown inside ogm-viewer. `message` is inherited from Error; redeclaring it
// here would emit an uninitialized class field that clobbers the value super() sets (under the
// es2022 define-fields semantics this project compiles with), leaving every subtype's message empty.
export class PreviewError extends Error {
  title: string;
  url?: string;
}

// The OGM record URL responded with a non-OK HTTP status.
class RecordLoadError extends PreviewError {
  title = "This record couldn't be loaded";

  constructor(status: number, url: string) {
    super(`The record URL responded with an error (HTTP ${status}). Check that the URL is correct and the record is publicly available.`);
    this.url = url;
  }
}

// The OGM record URL fetch failed due to a network error or CORS restriction.
class RecordNetworkError extends PreviewError {
  title = "This record couldn't be reached";

  constructor(url: string) {
    super('The server may be unreachable, or it may be blocking cross-origin (CORS) requests from this page.');
    this.url = url;
  }
}

// The OGM record couldn't be parsed as JSON.
class RecordParseError extends PreviewError {
  title = "This record couldn't be parsed";

  constructor(url: string) {
    super("The record URL didn't return valid JSON metadata. It may be pointing at an HTML page or a malformed file.");
    this.url = url;
  }
}

// Something else went wrong reading the record.
class RecordReadError extends PreviewError {
  title = "This record couldn't be read";

  constructor(message: string, url: string) {
    super(message);
    this.url = url;
  }
}

// The reference URL responded with a non-OK HTTP status.
class ReferenceLoadError extends PreviewError {
  constructor(refType: string, status: number, url?: string) {
    super(`The reference URL responded with an error (HTTP ${status}). Check that the URL is correct and the reference is publicly available.`);
    this.title = `The ${refType} preview couldn't be loaded`;
    this.url = url;
  }
}

// The reference URL fetch failed due to a network error or CORS restriction.
class ReferenceNetworkError extends PreviewError {
  constructor(refType: string, url?: string) {
    super('The server may be unreachable, or it may be blocking cross-origin (CORS) requests from this page.');
    this.title = `The ${refType} preview couldn't be reached`;
    this.url = url;
  }
}

// Something else went wrong reading the reference.
class ReferenceReadError extends PreviewError {
  constructor(refType: string, message: string, url?: string) {
    super(message);
    this.title = `The ${refType} preview couldn't be read`;
    this.url = url;
  }
}

// Used to re-raise HTTP responses from fetch() with a non-OK status as PreviewErrors
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

// Execute a fetch() and raise HttpError on non-OK status
export async function fetchOrThrow(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new HttpError(url, response.status, response.statusText);
  return response;
}

// Attempt to get a useful HTTP status code from any error. We only keep values
// over 400 because MapLibre uses code "0", which isn't a real HTTP status.
function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 ? status : undefined;
}

// A fetch() failure to reach the server at all, or a CORS block, rejects with a TypeError. MapLibre
// reports the same class of failure on its internal tile/data requests with a synthetic status of 0
// (not a real HTTP status). Treat both as a network error so the user sees the unreachable/CORS
// message rather than a generic read error or a nonsensical "HTTP 0".
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (error as { status?: unknown } | null)?.status === 0;
}

// Attempt get a useful message from any error.
function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

// Generate a PreviewError when something went wrong loading the record.
export function recordError(error: unknown, url: string): PreviewError {
  const status = statusOf(error);
  const message = messageOf(error);

  // The request failed to reach the server at all, or was blocked by CORS.
  if (isNetworkError(error)) return new RecordNetworkError(url);

  // If we have an HTTP status code, the server responded.
  if (status !== undefined) return new RecordLoadError(status, url);

  // A SyntaxError here means we got a response but it wasn't valid JSON metadata.
  if (error instanceof SyntaxError) return new RecordParseError(url);

  // Anything else (e.g. an unsupported metadata version thrown by OgmRecord's constructor).
  return new RecordReadError(message ?? 'An unknown error occurred while reading this record.', url);
}

// Generate a PreviewError when something went wrong loading an individual reference.
export function referenceError(error: unknown, refType: string, url?: string): PreviewError {
  const status = statusOf(error);
  const message = messageOf(error);

  // The request failed to reach the server at all, or was blocked by CORS.
  if (isNetworkError(error)) return new ReferenceNetworkError(refType, url);

  // If we have an HTTP status code, the server responded.
  if (status !== undefined) return new ReferenceLoadError(refType, status, url);

  // Anything else.
  return new ReferenceReadError(refType, message ?? 'An unknown error occurred while reading this reference.', url);
}
