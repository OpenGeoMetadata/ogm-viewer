import { readMetadataDocument } from './metadata-document';
import type { RequestTransform } from './request';

// What a raster's values can measure
export type Quantity = {
  name: string; // e.g. "Elevation"
  unit?: string; // e.g. "meters"
  datum?: string; // e.g. "North American Vertical Datum of 1988"
};

// The way a legend titles one, e.g. 'Elevation (meters)'
export const quantityLabel = ({ name, unit }: Quantity): string => (unit ? `${name} (${unit})` : name);

// Reads what a raster's values measure from the FGDC its record points at.
// Undefined when there is no FGDC, when it can't be read, or when it doesn't say.
export async function rasterQuantity(url: string | undefined, requestTransform?: RequestTransform): Promise<Quantity | undefined> {
  if (!url) return undefined;

  try {
    return parseFgdc(await readMetadataDocument(url, requestTransform));
  } catch (error) {
    console.warn(`Could not read what the values of a raster measure from ${url}:`, error);
    return undefined;
  }
}

// FGDC's Vertical Coordinate System Definition, which says what a dataset's heights or depths are
// measured from and in:
//
//   <spref><vertdef><altsys>
//     <altdatum>North American Vertical Datum of 1988</altdatum>
//     <altres>1.000000</altres>
//     <altunits>meters</altunits>
//
function parseFgdc(document: Document): Quantity | undefined {
  const altitudes = document.querySelector('spref > vertdef > altsys');
  if (altitudes) return quantity('Elevation', childText(altitudes, 'altunits'), childText(altitudes, 'altdatum'));

  const depths = document.querySelector('spref > vertdef > depthsys');
  if (depths) return quantity('Depth', childText(depths, 'depthdu'), childText(depths, 'depthdn'));

  return undefined;
}

// Strip keys a document left empty, so a legend never has to tell an absent unit from a blank one
const quantity = (name: string, unit?: string, datum?: string): Quantity => ({ name, ...(unit && { unit }), ...(datum && { datum }) });

// The text of a direct child, trimmed and collapsed to one line, or undefined when there isn't any
function childText(element: Element, tagName: string): string | undefined {
  const child = Array.from(element.children).find(candidate => candidate.tagName.toLowerCase() === tagName);
  return child?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
}
