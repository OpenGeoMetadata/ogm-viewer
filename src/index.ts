/**
 * @fileoverview The library behind the components.
 *
 * Everything here is also what the components use internally, from the same modules - so a resource
 * or previewer built by hand is the same kind of object <ogm-map> would have built for itself, and
 * the two share one copy of maplibre-gl. Reach for this when you have the data already and don't
 * want the record-driven path: build a Resource, wrap it in a Previewer, hand that to <ogm-preview>.
 *
 *   import { GeoJsonResource, GeoJsonPreviewer } from 'ogm-viewer/lib';
 *
 *   const resource = new GeoJsonResource('my-layer', 'https://example.com/data.json');
 *   document.querySelector('ogm-preview').previewer = new GeoJsonPreviewer(resource);
 *
 * The components themselves are not exported here; importing 'ogm-viewer' defines them.
 */

export type * from './components.d.ts';

// A record, and the references it points at
export { default as OgmRecord, OGM_FIELD_NAMES, type GeoBlacklightSchemaAardvark } from './lib/record';
export { References, REFERENCE_URIS, type LabelledLinks, type ReferenceName, type ReferencesRecord, type ReferenceURI } from './lib/references';

// Applied to every request a Resource makes on its own - and, once its previewer attaches to a
// map, to MapLibre's own tile and style requests too. Pass one to a Resource's constructor, to
// `resourcesFor`, or to <ogm-viewer>'s `requestTransform` property.
export { resolveRequest, type RequestResourceType, type RequestTransform, type TransformedRequest } from './lib/request';
export {
  annotationEvidence,
  annotationText,
  contentSearchRequestUrl,
  fetchContentSearch,
  fetchContentSearchPage,
  matchingEntities,
  pixelRegionFor,
  type ContentSearchAnnotation,
  type ContentSearchEntityMatch,
  type ContentSearchEvidence,
  type ContentSearchPage,
  type ContentSearchSelector,
  type ContentSearchTarget,
  type PixelRegion,
} from './lib/content-search';

// How a COG is read, so that a restricted one reaches deck.gl with whatever the transform asks for.
// Only needed if you are opening a COG yourself; DeckCogPreviewer does this for you.
export { openGeoTIFF, TransformedGeoTIFFSource } from './lib/geotiff';

// What a record's references point at. `resourcesFor` is the record-driven path; the classes are
// there for when you already know what you have.
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
// Where a record is, when what it holds can't be drawn - the one resource built from a shape rather
// than a URL. Reach for it directly to hold a place on the map while authentication is pending.
export { default as LocationResource } from './lib/resources/location';
export { default as OpenIndexMapResource } from './lib/resources/openindexmap';
export { default as PMTilesResource } from './lib/resources/pmtiles';
export { default as TileJsonResource } from './lib/resources/tilejson';
export { default as TmsResource } from './lib/resources/tms';
export { default as WmsResource, type GetFeatureInfoOptions } from './lib/resources/wms';
export { default as WmtsResource, type Bounds, type WmtsLayer, type WmtsOptions } from './lib/resources/wmts';
export { default as XyzResource } from './lib/resources/xyz';

// How a resource is drawn. One resource can offer more than one preview, so these are lists.
export { previewersFor, previewersForResources, type AnyPreviewer } from './lib/previewers/factory';
export { default as Previewer, type PreviewRenderer } from './lib/previewers/previewer';
export { default as MapPreviewer } from './lib/previewers/map';
export { default as RasterPreviewer, type AddRasterSourceObject } from './lib/previewers/raster';
export { default as VectorPreviewer, type AddVectorSourceObject } from './lib/previewers/vector';
export { default as InspectableRasterPreviewer } from './lib/previewers/inspectable-raster';
export { default as EsriRasterPreviewer } from './lib/previewers/esri-raster';
export { default as TiledVectorPreviewer } from './lib/previewers/tiled-vector';

// The two previews the record-driven path loads on demand rather than bundling, because deck.gl and
// Allmaps are large and most records need neither. Naming them here is a static import, so reach for
// these when you are building a previewer by hand and know you want one - which is also the way to
// get a COG with an Authorization header, since DeckCogPreviewer cannot carry one.
export { default as CogPreviewer } from './lib/previewers/cog';
export { default as DeckCogPreviewer } from './lib/previewers/cog-deck';
export { default as GeoreferencePreviewer } from './lib/previewers/georeference';
export { default as EsriDynamicMapLayerPreviewer } from './lib/previewers/esri-dynamic-map-layer';
export { default as EsriFeatureLayerPreviewer } from './lib/previewers/esri-feature-layer';
export { default as EsriImageMapLayerPreviewer } from './lib/previewers/esri-image-map-layer';
export { default as EsriTiledMapLayerPreviewer } from './lib/previewers/esri-tiled-map-layer';
export { default as GeoJsonPreviewer, type AddGeoJsonSourceObject } from './lib/previewers/geojson';
export { default as ImagePreviewer } from './lib/previewers/image';
// `locationsFor` is what <ogm-overview> turns records into: one extent apiece, keeping the place of
// a record it can't put anywhere, since that place is the number a reader sees on the map.
// `locationFor` is the one of them <ogm-locator> draws.
export { default as LocationPreviewer, locationFor, locationsFor } from './lib/previewers/location';
export { default as OpenIndexMapPreviewer } from './lib/previewers/openindexmap';
export { default as PMTilesRasterPreviewer } from './lib/previewers/pmtiles-raster';
export { default as PMTilesVectorPreviewer } from './lib/previewers/pmtiles-vector';
export { default as TileJsonRasterPreviewer } from './lib/previewers/tilejson-raster';
export { default as TileJsonVectorPreviewer } from './lib/previewers/tilejson-vector';
export { default as WmsPreviewer } from './lib/previewers/wms';
export { default as WmtsPreviewer } from './lib/previewers/wmts';

// What a preview is drawn with, and what a failed one reports
export { default as Theme } from './lib/themes/theme';
export { default as MapLibreTheme, darkBasemapStyle, lightBasemapStyle, type MapLibreStyle } from './lib/themes/maplibre';
export { isLayerDrawn, resolveLayerState, type Layer, type LayerControl, type LayerState, type PreviewStyleLayer } from './lib/layers';
export type { LegendEntry } from './lib/legend';

// Where to point a camera to see a record, or a set of them, at once. `clampToHemisphere` is the
// one that isn't obvious: a globe camera has no answer for a box wider than the half of the world
// facing it, so what's pointed at one is held to the half around its own middle.
export { unionBounds, clampToHemisphere, WORLD } from './lib/geometry';
export { fetchOrThrow, recordError, referenceError, HttpError, PreviewError } from './lib/errors';
