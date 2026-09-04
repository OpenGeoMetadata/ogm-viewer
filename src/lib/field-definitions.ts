import { fetchOrThrow } from './errors';
import type { References } from './references';
import { resolveRequest, type RequestTransform } from './request';

// What a publisher says one field of a dataset holds: a sentence about the field itself, and - where
// the values are codes rather than readable text - what each code stands for. Read from whichever
// metadata document the record points at; see fieldDefinitions below for which one.
export type FieldDefinition = {
  name: string;
  definition?: string;
  // Code as written in the data mapped to what it means, e.g. '1' -> 'Unrestricted public access'
  codedValues?: Map<string, string>;
};

// Every documented field of one dataset, keyed by lower-cased field name. Lower-cased because the
// two halves disagree about case and always have: a WMS GetFeatureInfo response comes back with
// 'routetype' where the FGDC that describes it says 'ROUTETYPE'.
export type FieldDefinitions = Map<string, FieldDefinition>;

// One read per document for the life of the page, shared by everything that asks. The promise is
// what's held rather than its result, so that two callers - the attribute table and the sidebar
// panel, which ask at different moments - share one fetch instead of racing two, and so that a
// document with nothing in it is remembered as such. Same reasoning as
// IIIFManifestResource#getGeoreferenceAnnotation; a failure is dropped from the cache below, so a
// document that was unreachable once can be asked for again.
const reads = new Map<string, Promise<FieldDefinitions | undefined>>();

// Reads the field definitions a record points at, or undefined when it points at none, when the
// document can't be read, or when it turns out to describe no fields.
//
// Most records have nothing to offer here: about a fifth of OpenGeoMetadata carries one of these
// references at all, and of those roughly half can't be read from a browser - a host that sends no
// CORS headers, a link that has gone dead, or a restricted item whose metadata redirects to a login
// page. So every caller has to be able to show its data without this, and nothing here is reported
// to the reader as an error: a dataset that doesn't explain its own fields is the ordinary case, not
// a broken preview.
export function fieldDefinitions(references: References, requestTransform?: RequestTransform): Promise<FieldDefinitions | undefined> {
  // FGDC first. Where a record has both - Stanford's do - the FGDC is at least as complete as the
  // ISO 19110 beside it, and it's the one that carries coded values in any quantity. ISO 19110 is
  // what records that have nothing else are read from.
  const url = references.fgdcUrl ?? references.iso19110Url;
  if (!url) return Promise.resolve(undefined);

  const started = reads.get(url) ?? read(url, references, requestTransform);
  reads.set(url, started);
  return started;
}

async function read(url: string, references: References, requestTransform?: RequestTransform): Promise<FieldDefinitions | undefined> {
  try {
    const document = await readDocument(url, requestTransform);
    const definitions = parseFgdc(document) ?? parseIso19110(document);

    // A document that parsed but describes nothing, which is most of what ISO 19139 would give us
    // and some of what the other two do. Treated the same as no document at all so that a caller
    // needs only one check, and - where the record named an FGDC that turned out to be empty - so
    // that the ISO 19110 beside it still gets its chance.
    if (definitions?.size) return definitions;

    const fallbackUrl = references.iso19110Url;
    if (url !== fallbackUrl && fallbackUrl) return await read(fallbackUrl, references, requestTransform);
    return undefined;
  } catch (error) {
    // Dropped so the next reader tries again rather than inheriting this answer: a session can be
    // established, or a token renewed, between one attempt and the next.
    reads.delete(url);
    console.warn(`Could not read field definitions from ${url}:`, error);
    return undefined;
  }
}

async function readDocument(url: string, requestTransform?: RequestTransform): Promise<Document> {
  const { url: resolved, init } = resolveRequest(url, 'metadata', requestTransform);
  const response = await fetchOrThrow(resolved, init);

  // A file server that wants authentication doesn't have to say so with a status: Stanford's answers
  // an unauthenticated read with a redirect to the identity provider, fetch follows it, and the
  // login page arrives with an OK status and HTML in the body. Left alone those bytes parse as a
  // document describing no fields, which is indistinguishable from a real one that says nothing.
  // See the same guard, for the same server, in TransformedGeoTIFFSource#request.
  if (response.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error(`Asked to sign in before reading ${url}`);
  }

  const document = new DOMParser().parseFromString(await response.text(), 'application/xml');

  // A browser answers malformed XML with a document containing a <parsererror> rather than throwing
  if (document.querySelector('parsererror')) throw new Error(`Could not parse ${url} as XML`);
  return document;
}

// FGDC's Entity and Attribute section, which is namespace-free - so plain selectors reach it:
//
//   <eainfo><detailed><attr>
//     <attrlabl>ACCESS</attrlabl>
//     <attrdef>Type of access to the road.</attrdef>
//     <attrdomv><edom><edomv>1</edomv><edomvd>Unrestricted public access</edomvd></edom></attrdomv>
//
// The richest of the three formats a record can point at: definitions written for people, and the
// only one that decodes its own values with any regularity.
function parseFgdc(document: Document): FieldDefinitions | undefined {
  const attributes = document.querySelectorAll('eainfo attr');
  if (!attributes.length) return undefined;

  const definitions: FieldDefinitions = new Map();
  for (const attribute of Array.from(attributes)) {
    const name = childText(attribute, 'attrlabl');
    if (!name) continue;

    const codedValues = new Map<string, string>();
    for (const domain of Array.from(attribute.querySelectorAll('attrdomv > edom'))) {
      const code = childText(domain, 'edomv');
      const meaning = childText(domain, 'edomvd');
      if (code !== undefined && meaning) codedValues.set(code, meaning);
    }

    definitions.set(name.toLowerCase(), {
      name,
      definition: childText(attribute, 'attrdef'),
      ...(codedValues.size && { codedValues }),
    });
  }

  return definitions;
}

// An ISO 19110 feature catalogue, which OpenGeoMetadata publishes under the gco reference key - see
// the note on that key in references.ts:
//
//   <gfc:FC_FeatureAttribute>
//     <gfc:memberName><gco:LocalName>MTFCC</gco:LocalName></gfc:memberName>
//     <gfc:definition><gco:CharacterString>MAF/TIGER feature class code</gco:CharacterString></gfc:definition>
//     <gfc:listedValue><gfc:FC_ListedValue>
//       <gfc:label><gco:CharacterString>C3023</gco:CharacterString></gfc:label>
//       <gfc:definition><gco:CharacterString>Island</gco:CharacterString></gfc:definition>
//
// Matched on local names rather than the gfc:/gco: prefixes those documents happen to use, since a
// prefix is the writer's choice and another one would mean the same thing.
function parseIso19110(document: Document): FieldDefinitions | undefined {
  const attributes = byLocalName(document, 'FC_FeatureAttribute');
  if (!attributes.length) return undefined;

  const definitions: FieldDefinitions = new Map();
  for (const attribute of attributes) {
    // Every lookup below is over direct children, not descendants: an attribute holds its listed
    // values, and each of those holds a definition of its own, so asking an attribute for "the
    // definition anywhere inside me" finds the first value's meaning instead of the field's. Its
    // definitionReference, which cites where the wording came from, is a second way to go wrong.
    const name = text(descend(attribute, ['memberName', 'LocalName']));
    if (!name) continue;

    const codedValues = new Map<string, string>();
    for (const listed of childrenByLocalName(attribute, 'listedValue').flatMap(value => childrenByLocalName(value, 'FC_ListedValue'))) {
      // label carries the code and definition carries what it means, which reads backwards but is
      // what the standard says
      const code = text(descend(listed, ['label']));
      const meaning = text(descend(listed, ['definition']));
      if (code !== undefined && meaning) codedValues.set(code, meaning);
    }

    definitions.set(name.toLowerCase(), {
      name,
      definition: text(descend(attribute, ['definition'])),
      ...(codedValues.size && { codedValues }),
    });
  }

  return definitions;
}

// The text of a direct child, trimmed, or undefined when there isn't one. Collapsed to one line the
// way any publisher-supplied text bound for a table cell has to be.
function childText(element: Element, tagName: string): string | undefined {
  const child = Array.from(element.children).find(candidate => candidate.tagName.toLowerCase() === tagName);
  return text(child);
}

function text(element: Element | undefined): string | undefined {
  const collapsed = element?.textContent?.replace(/\s+/g, ' ').trim();
  return collapsed || undefined;
}

function localName(element: Element): string {
  return element.localName ?? element.tagName.replace(/^.*:/, '');
}

function byLocalName(document: Document, name: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter(element => localName(element) === name);
}

function childrenByLocalName(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(child => localName(child) === name);
}

// Walks a path of direct children by local name, so a definition is only ever this element's own
function descend(element: Element, path: string[]): Element | undefined {
  return path.reduce<Element | undefined>((current, name) => (current ? childrenByLocalName(current, name)[0] : undefined), element);
}
