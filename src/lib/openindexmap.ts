import type { MapGeoJSONFeature } from 'maplibre-gl';

import { fetchOrThrow } from './errors';
import { resolveRequest, type RequestTransform } from './request';

export type SheetProperties = MapGeoJSONFeature['properties'] | null;

export type SheetField = { key: string; label: string; value: string; href?: string };

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

const THUMBNAIL_FIELD = 'thumbUrl';

const SHEET_LINKS: Record<string, string> = {
  websiteUrl: 'View this map',
  download: 'Download this map',
  iiifUrl: 'View manifest',
};

// Treat empty, sentinel, and non-HTTP values as absent rather than turning them into links.
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

export const sheetWebsite = (properties: SheetProperties): string | undefined => httpUrl(properties?.websiteUrl);

export const sheetHasImage = (properties: SheetProperties): boolean => Boolean(httpUrl(properties?.thumbUrl) || httpUrl(properties?.iiifUrl));

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

  if (typeof value === 'boolean') return { value: value ? 'Yes' : 'No' };

  return { value: Array.isArray(value) ? value.join(', ') : String(value) };
};

export const sheetThumbnail = async (properties: SheetProperties, requestTransform?: RequestTransform): Promise<string | undefined> => {
  const direct = httpUrl(properties?.thumbUrl);
  if (direct) return direct;

  const manifestUrl = httpUrl(properties?.iiifUrl);
  if (!manifestUrl) return undefined;

  try {
    const { url, init } = resolveRequest(manifestUrl, 'metadata', requestTransform);
    const response = await fetchOrThrow(url, init);
    return manifestThumbnail(await response.json());
  } catch (error) {
    console.warn(`Could not read a thumbnail from ${manifestUrl}:`, error);
    return undefined;
  }
};

const manifestThumbnail = (manifest: unknown): string | undefined => {
  const { thumbnail } = (manifest ?? {}) as { thumbnail?: unknown };
  const first = Array.isArray(thumbnail) ? thumbnail[0] : thumbnail;
  if (typeof first === 'string') return httpUrl(first);

  const image = (first ?? {}) as { 'id'?: unknown; '@id'?: unknown };
  return httpUrl(image.id ?? image['@id']);
};
