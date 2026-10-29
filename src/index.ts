export type * from './components.d.ts';

export { default as OgmRecord, OGM_FIELD_NAMES, type GeoBlacklightSchemaAardvark } from './lib/record';
export { References, REFERENCE_URIS, type LabelledLinks, type ReferenceName, type ReferencesRecord, type ReferenceURI } from './lib/references';

export { fieldDefinitions, type FieldDefinition, type FieldDefinitions } from './lib/field-definitions';
export { quantityLabel, rasterQuantity, type Quantity } from './lib/quantity';

export { resolveRequest, type RequestResourceType, type RequestTransform, type TransformedRequest } from './lib/request';

export { openGeoTIFF, TransformedGeoTIFFSource } from './lib/geotiff';

export { resourcesFor } from './lib/resources/factory';
export { default as Resource, type ResourceKind } from './lib/resources/resource';
export { default as MapResource } from './lib/resources/map';
export { default as RasterResource } from './lib/resources/raster';
export { default as VectorResource } from './lib/resources/vector';
export { default as EsriResource, EXPORT_TILE_SIZE, type EsriRasterSourceSpec } from './lib/resources/esri';
export { default as EsriMapServerResource } from './lib/resources/esri-map-server';
export { default as IIIFResource } from './lib/resources/iiif';
export { fetchGeoreferenceAnnotation, findGeoreferenceAnnotation, isGeoreferenceAnnotation, type GeoreferenceAnnotation } from './lib/resources/georeference';

export { default as CogResource } from './lib/resources/cog';
export { default as EsriDynamicMapLayerResource } from './lib/resources/esri-dynamic-map-layer';
export { default as EsriFeatureLayerResource } from './lib/resources/esri-feature-layer';
export { default as EsriImageMapLayerResource } from './lib/resources/esri-image-map-layer';
export { default as EsriTiledMapLayerResource } from './lib/resources/esri-tiled-map-layer';
export { default as GeoJsonResource } from './lib/resources/geojson';
export { default as IIIFManifestResource } from './lib/resources/iiif-manifest';
export { default as LocationResource } from './lib/resources/location';
export { default as OpenIndexMapResource } from './lib/resources/openindexmap';
export { default as PMTilesResource } from './lib/resources/pmtiles';
export { default as TileJsonResource } from './lib/resources/tilejson';
export { default as TmsResource } from './lib/resources/tms';
export { default as WmsResource, type GetFeatureInfoOptions } from './lib/resources/wms';
export { default as WmtsResource, type Bounds, type WmtsLayer, type WmtsOptions } from './lib/resources/wmts';
export { default as XyzResource } from './lib/resources/xyz';

export { previewersFor, previewersForResources, type AnyPreviewer } from './lib/previewers/factory';
export { default as Previewer, type PreviewRenderer } from './lib/previewers/previewer';
export { default as MapPreviewer } from './lib/previewers/map';
export { default as RasterPreviewer, type AddRasterSourceObject } from './lib/previewers/raster';
export { default as VectorPreviewer, type AddVectorSourceObject } from './lib/previewers/vector';
export { default as InspectableRasterPreviewer } from './lib/previewers/inspectable-raster';
export { default as EsriRasterPreviewer } from './lib/previewers/esri-raster';
export { default as TiledVectorPreviewer } from './lib/previewers/tiled-vector';

// These static exports include deck.gl and Allmaps; the record-driven path loads them on demand.
export { default as CogPreviewer } from './lib/previewers/cog';
export { default as GeoreferencePreviewer } from './lib/previewers/georeference';
export { default as EsriDynamicMapLayerPreviewer } from './lib/previewers/esri-dynamic-map-layer';
export { default as EsriFeatureLayerPreviewer } from './lib/previewers/esri-feature-layer';
export { default as EsriImageMapLayerPreviewer } from './lib/previewers/esri-image-map-layer';
export { default as EsriTiledMapLayerPreviewer } from './lib/previewers/esri-tiled-map-layer';
export { default as GeoJsonPreviewer, type AddGeoJsonSourceObject } from './lib/previewers/geojson';
export { default as ImagePreviewer } from './lib/previewers/image';
export { default as LocationPreviewer, locationFor, locationsFor } from './lib/previewers/location';
export { default as OpenIndexMapPreviewer } from './lib/previewers/openindexmap';
export { default as PMTilesRasterPreviewer } from './lib/previewers/pmtiles-raster';
export { default as PMTilesVectorPreviewer } from './lib/previewers/pmtiles-vector';
export { default as TileJsonRasterPreviewer } from './lib/previewers/tilejson-raster';
export { default as TileJsonVectorPreviewer } from './lib/previewers/tilejson-vector';
export { default as WmsPreviewer } from './lib/previewers/wms';
export { default as WmtsPreviewer } from './lib/previewers/wmts';
export { default as XyzPreviewer } from './lib/previewers/xyz';

export { default as Theme } from './lib/themes/theme';
export { default as MapLibreTheme, darkBasemapStyle, lightBasemapStyle, defaultBeforeId, type MapLibreStyle } from './lib/themes/maplibre';
export { isLayerDrawn, resolveLayerState, type Layer, type LayerControl, type LayerState, type PreviewStyleLayer } from './lib/layers';
export type { LegendEntry, LegendImage } from './lib/legend';

export { unionBounds, clampToHemisphere, WORLD } from './lib/geometry';
export { fetchOrThrow, recordError, referenceError, HttpError, PreviewError } from './lib/errors';
