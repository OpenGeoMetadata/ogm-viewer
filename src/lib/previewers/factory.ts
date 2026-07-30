import type MapResource from '../resources/map';
import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import type MapPreviewer from './map';

import CogPreviewer from './cog';
import EsriDynamicMapLayerPreviewer from './esri-dynamic-map-layer';
import EsriFeatureLayerPreviewer from './esri-feature-layer';
import EsriImageMapLayerPreviewer from './esri-image-map-layer';
import EsriTiledMapLayerPreviewer from './esri-tiled-map-layer';
import GeoJsonPreviewer from './geojson';
import ImagePreviewer from './image';
import OpenIndexMapPreviewer from './openindexmap';
import PMTilesRasterPreviewer from './pmtiles-raster';
import PMTilesVectorPreviewer from './pmtiles-vector';
import RasterPreviewer from './raster';
import TileJsonRasterPreviewer from './tilejson-raster';
import TileJsonVectorPreviewer from './tilejson-vector';
import WmsPreviewer from './wms';
import WmtsPreviewer from './wmts';

// Every preview this library can draw. The renderer is the discriminant, so a component can tell
// which one it's holding without a class test.
export type AnyPreviewer = MapPreviewer | ImagePreviewer;

// Builds every preview one resource offers
type PreviewerBuilder = (resource: Resource) => AnyPreviewer[] | Promise<AnyPreviewer[]>;

// Whether a tileset holds vector tiles. Reading that means reading a PMTiles header or a TileJSON
// document, either of which can fail.
const holdsVectors = async (resource: Resource): Promise<boolean> =>
  await (resource as MapResource).isVector().catch(error => {
    console.warn(`Could not tell whether ${resource.url} holds vector tiles:`, error);
    return false;
  });

// How each kind of resource is previewed. Keyed rather than tested in order, so adding a
// ResourceKind is a compile error until it says how it should be drawn, and a subclass no longer
// has to be listed ahead of its parent to be reachable at all.
const BUILDERS: Record<ResourceKind, PreviewerBuilder> = {
  'iiif-image': resource => [new ImagePreviewer(resource)],
  'iiif-manifest': resource => [new ImagePreviewer(resource)],
  'geojson': resource => [new GeoJsonPreviewer(resource)],
  'openindexmap': resource => [new OpenIndexMapPreviewer(resource)],
  'esri-feature-layer': resource => [new EsriFeatureLayerPreviewer(resource)],
  'esri-dynamic-map-layer': resource => [new EsriDynamicMapLayerPreviewer(resource)],
  'esri-image-map-layer': resource => [new EsriImageMapLayerPreviewer(resource)],
  'esri-tiled-map-layer': resource => [new EsriTiledMapLayerPreviewer(resource)],
  'wms': resource => [new WmsPreviewer(resource)],
  'wmts': resource => [new WmtsPreviewer(resource)],
  'cog': resource => [new CogPreviewer(resource)],
  'tms': resource => [new RasterPreviewer(resource)],
  'xyz': resource => [new RasterPreviewer(resource)],

  // An archive or a tileset document can describe either kind of tiles, and the only way to find
  // out is to read it
  'pmtiles': async resource => [(await holdsVectors(resource)) ? new PMTilesVectorPreviewer(resource) : new PMTilesRasterPreviewer(resource)],
  'tilejson': async resource => [(await holdsVectors(resource)) ? new TileJsonVectorPreviewer(resource) : new TileJsonRasterPreviewer(resource)],
};

/**
 * Every preview a single resource offers. A list, because one resource can be worth showing more
 * than one way: a georeferenced scan is both an image to page through and a map to overlay, and
 * each of those is its own tab.
 */
export async function previewersFor(resource: Resource): Promise<AnyPreviewer[]> {
  const builder = BUILDERS[resource.kind];

  // Only reached by a resource built from a copy of this library newer than the one drawing it
  if (!builder) {
    console.warn(`No preview for resource kind: ${resource.kind}`);
    return [];
  }

  return await builder(resource);
}

/**
 * Every preview a list of resources offers, in the order they were given - which is the tab order.
 * Never rejects: this is awaited before the tabs are rendered, where a rejection would leave the
 * whole record without a preview rather than the one reference that failed.
 */
export async function previewersForResources(resources: Resource[]): Promise<AnyPreviewer[]> {
  const previewers = await Promise.all(resources.map(resource => previewersFor(resource)));
  return previewers.flat();
}
