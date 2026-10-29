import { readMetadataDocument } from './metadata-document';
import type { References } from './references';
import type { RequestTransform } from './request';

export type FieldDefinition = {
  name: string;
  definition?: string;
  codedValues?: Map<string, string>;
};

// Use lowercase keys to match field names across metadata and service responses.
export type FieldDefinitions = Map<string, FieldDefinition>;

const reads = new Map<string, Promise<FieldDefinitions | undefined>>();

export function fieldDefinitions(references: References, requestTransform?: RequestTransform): Promise<FieldDefinitions | undefined> {
  // Prefer FGDC when both documents exist because it usually includes the coded-value definitions.
  const url = references.fgdcUrl ?? references.iso19110Url;
  if (!url) return Promise.resolve(undefined);

  const started = reads.get(url) ?? read(url, references, requestTransform);
  reads.set(url, started);
  return started;
}

async function read(url: string, references: References, requestTransform?: RequestTransform): Promise<FieldDefinitions | undefined> {
  try {
    const document = await readMetadataDocument(url, requestTransform);
    const definitions = parseFgdc(document) ?? parseIso19110(document);

    if (definitions?.size) return definitions;

    const fallbackUrl = references.iso19110Url;
    if (url !== fallbackUrl && fallbackUrl) return await read(fallbackUrl, references, requestTransform);
    return undefined;
  } catch (error) {
    reads.delete(url);
    console.warn(`Could not read field definitions from ${url}:`, error);
    return undefined;
  }
}

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

function parseIso19110(document: Document): FieldDefinitions | undefined {
  const attributes = byLocalName(document, 'FC_FeatureAttribute');
  if (!attributes.length) return undefined;

  const definitions: FieldDefinitions = new Map();
  for (const attribute of attributes) {
    // Read direct children so a listed value definition is not mistaken for its field definition.
    const name = text(descend(attribute, ['memberName', 'LocalName']));
    if (!name) continue;

    const codedValues = new Map<string, string>();
    for (const listed of childrenByLocalName(attribute, 'listedValue').flatMap(value => childrenByLocalName(value, 'FC_ListedValue'))) {
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

function descend(element: Element, path: string[]): Element | undefined {
  return path.reduce<Element | undefined>((current, name) => (current ? childrenByLocalName(current, name)[0] : undefined), element);
}
