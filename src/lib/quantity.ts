import { readMetadataDocument } from './metadata-document';
import type { RequestTransform } from './request';

export type Quantity = {
  name: string; // e.g. "Elevation"
  unit?: string; // e.g. "meters"
  datum?: string; // e.g. "North American Vertical Datum of 1988"
};

export const quantityLabel = ({ name, unit }: Quantity): string => (unit ? `${name} (${unit})` : name);

export async function rasterQuantity(url: string | undefined, requestTransform?: RequestTransform): Promise<Quantity | undefined> {
  if (!url) return undefined;

  try {
    return parseFgdc(await readMetadataDocument(url, requestTransform));
  } catch (error) {
    console.warn(`Could not read what the values of a raster measure from ${url}:`, error);
    return undefined;
  }
}

function parseFgdc(document: Document): Quantity | undefined {
  const altitudes = document.querySelector('spref > vertdef > altsys');
  if (altitudes) return quantity('Elevation', childText(altitudes, 'altunits'), childText(altitudes, 'altdatum'));

  const depths = document.querySelector('spref > vertdef > depthsys');
  if (depths) return quantity('Depth', childText(depths, 'depthdu'), childText(depths, 'depthdn'));

  return undefined;
}

const quantity = (name: string, unit?: string, datum?: string): Quantity => ({ name, ...(unit && { unit }), ...(datum && { datum }) });

function childText(element: Element, tagName: string): string | undefined {
  const child = Array.from(element.children).find(candidate => candidate.tagName.toLowerCase() === tagName);
  return child?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
}
