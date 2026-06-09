import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';
import type { OgmRecord } from './record';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool } from '@developmentseed/geotiff';
import { PMTiles } from 'pmtiles';

export type AddSourceObject = { id: string; source: SourceSpecification };
type LayerType = Exclude<AddLayerObject['type'], 'custom'>;
type PMTilesVectorMetadata = { vector_layers?: { id: string }[] };

// Given a record, generate the appropriate source for previewing the data
export const getPreviewSource = async (record: OgmRecord): Promise<AddSourceObject | undefined> => {
  // If nothing we can render from references, warn and bail out
  const bestSource = await getRecordSource(record);
  if (!bestSource) {
    console.warn(`No suitable preview source found for record ${record.id}`);
    return;
  }

  return bestSource;
};

// Given a record, generate a geoJSON source for its bounding box/geometry
export const getBoundsPreviewSource = (record: OgmRecord): AddSourceObject | undefined => {
  const bounds = record.getGeometry();
  if (!bounds) return;

  return {
    id: `${record.id}-bounds`,
    source: {
      type: 'geojson',
      // @ts-ignore
      data: bounds,
      attribution: record.attribution,
    },
  };
};

// Given a record and source, generate preview layer(s) for the map
export const getPreviewLayers = async (record: OgmRecord, source: AddSourceObject): Promise<AddLayerObject[]> => {
  const type = getLayerType(record, source.source);
  const pmTilesMetadata = await getPMTilesMetadata(record);

  // If it's a vector PMTiles source, we need to specify the source layer; we'll just use the first one
  let sourceLayer: string | undefined;
  if (type != 'raster' && pmTilesMetadata) {
    sourceLayer = pmTilesMetadata.vector_layers?.[0].id;
  }

  return [
    {
      id: `${source.id}-preview-${type}`,
      type,
      source: source.id,
      ...(sourceLayer && { 'source-layer': sourceLayer }),
    } as AddLayerObject,
  ];
};

// Fetch metadata for a PMTiles source, if possible
const getPMTilesMetadata = async (record: OgmRecord): Promise<PMTilesVectorMetadata | undefined> => {
  // If no PMTile, nothing to do
  if (!record.references.pmtilesUrl) return;

  // Create a PMTiles source to read the metadata
  const pmtilesData = new PMTiles(record.references.pmtilesUrl);
  const metadata = (await pmtilesData.getMetadata()) as PMTilesVectorMetadata;
  return metadata;
};

// Generate two styled layers using a record's geoJSON bounds source
export const getBoundsPreviewLayers = (record: OgmRecord): AddLayerObject[] => {
  return [
    {
      id: `${record.id}-bounds-fill`,
      type: 'fill',
      source: `${record.id}-bounds`,
      paint: {
        'fill-color': '#888888',
        'fill-opacity': 0.5,
      },
    },
    {
      id: `${record.id}-bounds-outline`,
      type: 'line',
      source: `${record.id}-bounds`,
      paint: {
        'line-color': '#000000',
        'line-width': 2,
      },
    },
  ];
};

// Map source types to layer types using information from the record
const getLayerType = (record: OgmRecord, source: SourceSpecification): LayerType => {
  // Raster is easy...
  if (source.type === 'raster') return 'raster';

  // For Vector sources, we need to check the resource type to style it
  if (source.type === 'geojson' || source.type === 'vector') {
    if (record.resourceType?.includes('Point data')) return 'circle';
    if (record.resourceType?.includes('Line data')) return 'line';
    return 'fill'; // Default to fill for polygons
  } else throw new Error(`Unsupported source type: ${source.type}`);
};

// Given a record, choose the best source used to preview it on the map
const getRecordSource = async (record: OgmRecord): Promise<AddSourceObject | undefined> => {
  return (
    [
      // Methods that create new sources are added here in order of preference
      // The first one that returns a valid source will be used
      await recordPMTilesSource(record),
      recordGeoJSONSource(record),
      recordWMSSource(record),
      recordTMSSource(record),
      recordXYZSource(record),
    ].find(Boolean) || undefined
  );
};

const recordXYZSource = (record: OgmRecord): AddSourceObject | undefined => {
  // If no XYZ reference, nothing to do
  const xyzUrl = record.references.xyzUrl;
  if (!xyzUrl) return;

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
const recordTMSSource = (record: OgmRecord): AddSourceObject | undefined => {
  // If no TMS reference, nothing to do
  const tmsUrl = record.references.tmsUrl;
  if (!tmsUrl) return;

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
const recordGeoJSONSource = (record: OgmRecord): AddSourceObject | undefined => {
  // If no GeoJSON reference, nothing to do
  const geojsonUrl = record.references.geojsonUrl;
  if (!geojsonUrl) return;

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

// Given a record, create a PMTiles source, if possible
const recordPMTilesSource = async (record: OgmRecord): Promise<AddSourceObject | undefined> => {
  // If no PMTiles reference, nothing to do
  const pmtilesUrl = record.references.pmtilesUrl;
  if (!pmtilesUrl) return;

  // Add the pmtiles:// protocol that will tell MapLibre to use the plugin
  const url = `pmtiles://${pmtilesUrl}`;

  // Check if it's a vector
  const metadata = await getPMTilesMetadata(record);
  const isVector = !!metadata?.vector_layers && metadata.vector_layers.length > 0;

  return {
    id: record.id,
    source: {
      type: isVector ? 'vector' : 'raster',
      url,
      attribution: record.attribution,
    },
  };
};

// Given a record, create a MapLibre WMS source, if possible
const recordWMSSource = (record: OgmRecord): AddSourceObject | undefined => {
  // If no WMS reference or no WXS layer identifier, nothing we can do
  const wmsUrl = record.references.wmsUrl;
  if (!wmsUrl) return;
  const layerIds = [record.wxsIdentifier];
  if (typeof layerIds[0] !== 'string') return;

  // Generate the source spec with a unique ID based on the record
  const source = createWMSSource({ wmsUrl, layerIds: layerIds as string[], attribution: record.attribution });
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
}: {
  wmsUrl: string;
  layerIds: string[];
  bbox?: string;
  srs?: string;
  tileSize?: number;
  format?: string;
  transparent?: boolean;
  attribution?: string;
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

// Generate a Deck.GL layer for a COG from an OGM record
export const recordDeckGLCOGLayer = (record: OgmRecord): COGLayer => {
  return new COGLayer({
    id: record.id,
    geotiff: record.references.cogUrl,
    // Disable the web worker decoder pool; this appears to cause errors because
    // it can't find /worker.js?
    // See: https://developmentseed.org/deck.gl-raster/api/geotiff/type-aliases/DecoderPoolOptions/
    // See also: https://github.com/developmentseed/deck.gl-raster/issues/364
    pool: new DecoderPool({
      createWorker: undefined,
    }),
  });
};
