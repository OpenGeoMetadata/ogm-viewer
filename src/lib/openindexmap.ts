import type { MapGeoJSONFeature } from 'maplibre-gl';

import { fetchOrThrow } from './errors';
import { resolveRequest, type RequestTransform } from './request';

// One sheet's properties, as MapLibre hands them over from the index map's GeoJSON. Nullable, which
// MapLibre's own type isn't: a GeoJSON feature is allowed no properties at all, and a source that
// passes one through hands on the null - which is why ogm-attributes has always read them with `|| {}`.
export type SheetProperties = MapGeoJSONFeature['properties'] | null;

// One row describing a sheet: what to call the property, what it says, and where it points when it
// is a link we can name.
export type SheetField = { key: string; label: string; value: string; href?: string };

// Every property the OpenIndexMaps spec defines, each with the name to show it under, ordered the way
// they read rather than the way the schema lists them: what the sheet is, when it was made, what it
// looks like, who holds it, where to get it, and last the extents and file names that are there for
// machines. https://openindexmaps.org/specification/1.0.0
const SHEET_FIELDS: Record<string, string> = {
  label: 'Sheet',
  labelAlt: 'Alternate sheet',
  labelAlt2: 'Second alternate sheet',
  title: 'Title',
  titleAlt: 'Alternate title',
  location: 'Location',
  datePub: 'Published',
  date: 'Date',
  dateSurvey: 'Surveyed',
  datePhoto: 'Photocorrected',
  dateReprnt: 'Reprinted',
  edition: 'Edition',
  publisher: 'Publisher',
  scale: 'Scale',
  projection: 'Projection',
  primeMer: 'Prime meridian',
  color: 'Color',
  bands: 'Spectral bands',
  contLines: 'Contour lines',
  contInterv: 'Contour interval',
  bathLines: 'Bathymetric lines',
  bathInterv: 'Bathymetric interval',
  overprint: 'Overprint',
  overlays: 'Overlays',
  photomos: 'Photomosaic',
  rectificn: 'Rectification',
  rollNo: 'Film roll',
  inst: 'Institution',
  available: 'Available',
  physHold: 'Physical holdings',
  digHold: 'Digital holdings',
  lcCallNo: 'LC call number',
  instCallNo: 'Call number',
  sheetId: 'Sheet ID',
  recId: 'Record ID',
  websiteUrl: 'Web link',
  download: 'Download',
  iiifUrl: 'IIIF manifest',
  fileName: 'File name',
  west: 'West',
  east: 'East',
  north: 'North',
  south: 'South',
  note: 'Note',
};

// Shown as the sheet's picture instead of as a row of its own; see sheetThumbnail
const THUMBNAIL_FIELD = 'thumbUrl';

// The properties that are always a link, and what to call it. Nothing else is promoted: physHold and
// digHold are a link only sometimes - the spec lets either be a plain note about what the institution
// holds - so they go through the same autolinking as any other value.
const SHEET_LINKS: Record<string, string> = {
  websiteUrl: 'View this map',
  download: 'Download this map',
  iiifUrl: 'View manifest',
};

// An absolute http(s) URL, or nothing. An index map is an export of someone's shapefile, and a column
// with no value for a given sheet is often filled in rather than left empty - Stanford's Dalian index
// map writes "0" in every field of a sheet it doesn't hold - so a property is only turned into a link
// once it parses as one. Rejecting every other scheme also keeps a `javascript:` URL in someone
// else's data from becoming an href of ours.
const httpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '';

// Where a click on the sheet's thumbnail goes: the same place its Web link row points.
export const sheetWebsite = (properties: SheetProperties): string | undefined => httpUrl(properties?.websiteUrl);

// Whether the sheet claims a picture at all, answered from its properties alone. sheetThumbnail may
// have to read a manifest before it can hand one over, and the popup has to know which of the picture
// and the properties to open on before that comes back - otherwise it opens on the properties and
// swaps itself out from under the reader a moment later.
export const sheetHasImage = (properties: SheetProperties): boolean => Boolean(httpUrl(properties?.thumbUrl) || httpUrl(properties?.iiifUrl));

// Describe a sheet for display: the spec's properties first, named and in reading order, then
// whatever else the index map carries, under its own keys - every index map has a few columns of its
// own, and dropping them would hide the only copy of them anyone gets to see.
//
// Empty properties are left out, which the generic attribute table deliberately doesn't do: a sheet
// may declare forty-odd properties and leave most of them null, and forty empty rows describe nothing.
export const describeSheet = (properties: SheetProperties): SheetField[] => {
  const order = Object.keys(SHEET_FIELDS);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);

  return Object.entries(properties ?? {})
    .filter(([key, value]) => key !== THUMBNAIL_FIELD && !isEmpty(value))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, value]) => ({ key, label: SHEET_FIELDS[key] ?? key, ...describeValue(key, value) }));
};

const describeValue = (key: string, value: unknown): { value: string; href?: string } => {
  const linkText = SHEET_LINKS[key];
  const href = linkText ? httpUrl(value) : undefined;
  if (href) return { value: linkText, href };

  // Several of the spec's properties are flags - whether the institution holds the sheet, whether the
  // map has contour lines - and `true` in a table of prose reads like a value rather than an answer
  if (typeof value === 'boolean') return { value: value ? 'Yes' : 'No' };

  // `location` is a list of place names; the rest are scalars
  return { value: Array.isArray(value) ? value.join(', ') : String(value) };
};

// A picture of the sheet, if the index map offers one: thumbUrl says so outright, and failing that a
// IIIF manifest carries a thumbnail of its own, which is how Stanford's index maps have one. Nothing
// beyond those two - an institution that can work a thumbnail out from an identifier, purl's druid to
// a stacks preview.jpg say, knows something about its own URLs that the spec doesn't.
export const sheetThumbnail = async (properties: SheetProperties, requestTransform?: RequestTransform): Promise<string | undefined> => {
  const direct = httpUrl(properties?.thumbUrl);
  if (direct) return direct;

  const manifestUrl = httpUrl(properties?.iiifUrl);
  if (!manifestUrl) return undefined;

  // A picture is not worth failing an inspection over, and a restricted sheet inside a public index
  // map is an ordinary thing to run into
  try {
    const { url, init } = resolveRequest(manifestUrl, 'metadata', requestTransform);
    const response = await fetchOrThrow(url, init);
    return manifestThumbnail(await response.json());
  } catch (error) {
    console.warn(`Could not read a thumbnail from ${manifestUrl}:`, error);
    return undefined;
  }
};

// Presentation 2 hangs a single thumbnail off the manifest and names it @id, 3 takes a list and names
// it id, and some v2 manifests give the URL as a bare string.
const manifestThumbnail = (manifest: unknown): string | undefined => {
  const { thumbnail } = (manifest ?? {}) as { thumbnail?: unknown };
  const first = Array.isArray(thumbnail) ? thumbnail[0] : thumbnail;
  if (typeof first === 'string') return httpUrl(first);

  const image = (first ?? {}) as { 'id'?: unknown; '@id'?: unknown };
  return httpUrl(image.id ?? image['@id']);
};
