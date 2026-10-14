import { fetchOrThrow } from './errors';
import { resolveRequest, type RequestTransform } from './request';

// One fetch per metadata document for the life of the page, shared by everything that reads one: the
// field definitions the sidebar and the attribute table name fields with, and what a raster's values
// measure, which its legend is titled with. They ask for the same FGDC at different moments, and each
// would otherwise fetch it again. The promise is what's held, so that two readers asking at once share
// one request rather than racing two; and the text rather than a parsed Document, since a DOM is
// several times the size of the text it came from and parsing a few kilobytes again costs nothing next
// to a request. A failure is dropped, so a document that was unreachable once can be asked for again.
const texts = new Map<string, Promise<string>>();

// Reads a metadata document as XML. Rejects when it can't be read, when a login page arrives in its
// place, or when it isn't XML at all - every reader of one has to be able to go without it, since about
// half the documents OpenGeoMetadata records point at can't be read from a browser.
export async function readMetadataDocument(url: string, requestTransform?: RequestTransform): Promise<Document> {
  const started = texts.get(url) ?? fetchText(url, requestTransform);
  texts.set(url, started);

  let text: string;
  try {
    text = await started;
  } catch (error) {
    // Only this attempt's own entry: another reader may already have started the next one
    if (texts.get(url) === started) texts.delete(url);
    throw error;
  }

  const document = new DOMParser().parseFromString(text, 'application/xml');

  // A browser answers malformed XML with a document containing a <parsererror> rather than throwing
  if (document.querySelector('parsererror')) throw new Error(`Could not parse ${url} as XML`);
  return document;
}

async function fetchText(url: string, requestTransform?: RequestTransform): Promise<string> {
  const { url: resolved, init } = resolveRequest(url, 'metadata', requestTransform);
  const response = await fetchOrThrow(resolved, init);

  // A file server that wants authentication doesn't have to say so with a status: Stanford's answers
  // an unauthenticated read with a redirect to the identity provider, fetch follows it, and the
  // login page arrives with an OK status and HTML in the body. Left alone those bytes parse as a
  // document that says nothing, which is indistinguishable from a real one that says nothing.
  // See the same guard, for the same server, in TransformedGeoTIFFSource#request.
  if (response.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error(`Asked to sign in before reading ${url}`);
  }

  return await response.text();
}
