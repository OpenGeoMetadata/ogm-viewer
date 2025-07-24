import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';
import type { OgmRecord } from './record';

type AddSourceObject = { id: string; source: SourceSpecification };
type LayerType = Exclude<AddLayerObject['type'], 'custom'>;

// Given a record, generate a preview layer with embedded source for the map
export const getPreviewLayer = (record: OgmRecord): AddLayerObject => {
  const { id, source } = getRecordSource(record);
  const type = getLayerType(record, source);
  return { id, type, source }; // The ID always matches the record & source ID
};

// Map source types to layer types using information from the record
const getLayerType = (_record: OgmRecord, source: SourceSpecification): LayerType => {
  // For now, we only support raster layers
  if (source.type === 'raster') return 'raster';
  else throw new Error(`Unsupported source type: ${source.type}`);
};

// Given a record, choose the best source used to preview it on the map
const getRecordSource = (record: OgmRecord): AddSourceObject => {
  return [
    // Methods that create new sources are added here in order of preference
    // The first one that returns a valid source will be used
    recordWMSSource(record),
  ].find(Boolean);
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
