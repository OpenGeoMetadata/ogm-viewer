import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';
import type { OgmRecord } from './record';

type AddSourceObject = { id: string; source: SourceSpecification };
type LayerType = Exclude<AddLayerObject['type'], 'custom'>;

// Given a record, generate a preview layer with embedded source for the map
export const getPreviewLayer = (record: OgmRecord): AddLayerObject => {
  // If nothing we can render from references, warn and bail out
  const bestSource = getRecordSource(record);
  if (!bestSource) {
    console.warn(`No suitable preview source found for record ${record.id}`);
    return;
  }

  // Generate a mapLibre layer object with embedded source
  const { id, source } = bestSource;
  const type = getLayerType(record, source);
  return { id, type, source }; // The ID always matches the record & source ID
};

// Map source types to layer types using information from the record
const getLayerType = (record: OgmRecord, source: SourceSpecification): LayerType => {
  // Raster is easy...
  if (source.type === 'raster') return 'raster';

  // For Vector sources, we need to check the resource type to style it
  if (source.type === 'geojson') {
    if (record.resourceType?.includes('Point data')) return 'circle';
    if (record.resourceType?.includes('Line data')) return 'line';
    return 'fill'; // Default to fill for polygons
  } else throw new Error(`Unsupported source type: ${source.type}`);
};

// Given a record, choose the best source used to preview it on the map
const getRecordSource = (record: OgmRecord): AddSourceObject => {
  return [
    // Methods that create new sources are added here in order of preference
    // The first one that returns a valid source will be used
    recordGeoJSONSource(record),
    recordCOGSource(record),
    recordWMSSource(record),
    recordTMSSource(record),
    recordXYZSource(record),
  ].find(Boolean);
};

const recordXYZSource = (record: OgmRecord): AddSourceObject => {
  // If no XYZ reference, nothing to do
  const xyzUrl = record.references.xyz;
  if (!xyzUrl) return null;

  return {
    id: record.id,
    source: {
      type: 'raster',
      tiles: [xyzUrl],
      scheme: 'xyz',
      tileSize: 256,
      attribution: record.attribution,
    },
  };
};

// Given a record, create a MapLibre TMS source, if possible
const recordTMSSource = (record: OgmRecord): AddSourceObject => {
  // If no TMS reference, nothing to do
  const tmsUrl = record.references.tms;
  if (!tmsUrl) return null;

  return {
    id: record.id,
    source: {
      type: 'raster',
      tiles: [tmsUrl],
      scheme: 'tms',
      tileSize: 256,
      attribution: record.attribution,
    },
  };
};

// Given a record, create a MapLibre GeoJSON source, if possible
const recordGeoJSONSource = (record: OgmRecord): AddSourceObject => {
  // If no GeoJSON reference, nothing to do
  const geojsonUrl = record.references.geojson;
  if (!geojsonUrl) return null;

  // Create a GeoJSON source with the record's ID and attribution
  return {
    id: record.id,
    source: {
      type: 'geojson',
      data: geojsonUrl,
      attribution: record.attribution,
    },
  };
};

// Given a record, create a MapLibre COG source, if possible
const recordCOGSource = (record: OgmRecord): AddSourceObject => {
  // If no COG reference, nothing to do
  const cogUrl = record.references.cog;
  if (!cogUrl) return null;

  // Add the cog:// protocol that will tell MapLibre to use the plugin
  const url = `cog://${cogUrl}`;

  return {
    id: record.id,
    source: {
      type: 'raster',
      url,
      tileSize: 256,
      attribution: record.attribution,
    },
  };
};

// Given a record, create a MapLibre WMS source, if possible
const recordWMSSource = (record: OgmRecord): AddSourceObject => {
  // If no WMS reference or no WXS layer identifier, nothing we can do
  const wmsUrl = record.references.wms;
  if (!wmsUrl) return null;
  const layerIds = [record.wxsIdentifier];
  if (!layerIds[0]) return null;

  // Generate the source spec with a unique ID based on the record
  const source = createWMSSource({ wmsUrl, layerIds, attribution: record.attribution });
  const id = record.id;
  return { id, source };
};

// Create a MapLibre raster source specification object for a WMS layer
// Default is 256px transparent PNG tiles in EPSG:3857 projection
const createWMSSource = ({
  wmsUrl,
  layerIds,
  bbox = '{bbox-epsg-3857}',
  srs = 'EPSG:3857',
  tileSize = 256,
  format = 'image/png',
  transparent = true,
  attribution = '',
}): SourceSpecification => {
  const tilesUrl = new URL(wmsUrl);

  // Construct the WMS URL with required parameters
  tilesUrl.searchParams.set('service', 'WMS');
  tilesUrl.searchParams.set('request', 'GetMap');
  tilesUrl.searchParams.set('layers', layerIds.join(','));
  tilesUrl.searchParams.set('width', String(tileSize));
  tilesUrl.searchParams.set('height', String(tileSize));
  tilesUrl.searchParams.set('transparent', String(transparent));
  tilesUrl.searchParams.set('srs', srs);
  tilesUrl.searchParams.set('format', format);

  // This param can't be encoded because MapLibre needs to template it
  let tilesUrlString = tilesUrl.toString();
  tilesUrlString += `&bbox=${bbox}`;

  return {
    type: 'raster',
    tiles: [tilesUrlString],
    tileSize,
    attribution,
  };
};
