import { fetchOrThrow } from './errors';
import { resolveRequest, type RequestTransform } from './request';

const texts = new Map<string, Promise<string>>();

export async function readMetadataDocument(url: string, requestTransform?: RequestTransform): Promise<Document> {
  const started = texts.get(url) ?? fetchText(url, requestTransform);
  texts.set(url, started);

  let text: string;
  try {
    text = await started;
  } catch (error) {
    if (texts.get(url) === started) texts.delete(url);
    throw error;
  }

  const document = new DOMParser().parseFromString(text, 'application/xml');

  if (document.querySelector('parsererror')) throw new Error(`Could not parse ${url} as XML`);
  return document;
}

async function fetchText(url: string, requestTransform?: RequestTransform): Promise<string> {
  const { url: resolved, init } = resolveRequest(url, 'metadata', requestTransform);
  const response = await fetchOrThrow(resolved, init);

  // An authentication redirect can return a successful HTML login page instead of metadata XML.
  if (response.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error(`Asked to sign in before reading ${url}`);
  }

  return await response.text();
}
