import type IIIFManifestResource from '../resources/iiif-manifest';
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
import LocationPreviewer from './location';
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

// deck.gl and Allmaps are each large enough to be worth not making every record pay for: together
// they are more than half again the size of everything else here, and only a COG or a georeferenced
// scan needs either. So they load on demand, which the ESM-only output target (#133) made possible -
// the CommonJS render that used to be built alongside it flattened dynamic imports back in.
//
// A chunk that won't load leaves the rest of the record previewable rather than failing it outright.
const lazily = async <T>(load: () => Promise<{ default: new (resource: Resource) => T }>, resource: Resource, what: string): Promise<T | undefined> => {
  try {
    const { default: Previewer } = await load();
    return new Previewer(resource);
  } catch (error) {
    console.warn(`Could not load the ${what} previewer for ${resource.url}:`, error);
    return undefined;
  }
};

// Whether a manifest also describes where on the earth its scan belongs. Costs the manifest fetch,
// and usually one more for an annotation page the manifest only links; the resource memoizes both.
// try/catch rather than .catch(): a resource built by an older copy of this library has no such
// method at all, and that throws on the way in rather than rejecting.
const isGeoreferenced = async (resource: Resource): Promise<boolean> => {
  try {
    return await (resource as IIIFManifestResource).isGeoreferenced();
  } catch (error) {
    console.warn(`Could not tell whether ${resource.url} is georeferenced:`, error);
    return false;
  }
};

// How each kind of resource is previewed. Keyed rather than tested in order, so adding a
// ResourceKind is a compile error until it says how it should be drawn, and a subclass no longer
// has to be listed ahead of its parent to be reachable at all.
const BUILDERS: Record<ResourceKind, PreviewerBuilder> = {
  'iiif-image': resource => [new ImagePreviewer(resource)],

  // A georeferenced scan is the case this whole list is plural for: the same manifest is both an
  // image to page through and a layer to overlay on a map. The image comes first, because it is what
  // the scan is - the map is a second reading of it.
  'iiif-manifest': async resource => {
    const previewers: AnyPreviewer[] = [new ImagePreviewer(resource)];
    if (!(await isGeoreferenced(resource))) return previewers;

    const georeference = await lazily(() => import('./georeference'), resource, 'georeferenced map');
    return georeference ? [...previewers, georeference] : previewers;
  },

  'geojson': resource => [new GeoJsonPreviewer(resource)],
  // Not built from a reference: this is the one resource a record makes out of its own metadata,
  // when nothing it points at can be drawn on a map. Whether that's so is decided in
  // previewersForResources, not here. See also resourcesFor.
  'location': resource => [new LocationPreviewer(resource)],
  'openindexmap': resource => [new OpenIndexMapPreviewer(resource)],
  'esri-feature-layer': resource => [new EsriFeatureLayerPreviewer(resource)],
  'esri-dynamic-map-layer': resource => [new EsriDynamicMapLayerPreviewer(resource)],
  'esri-image-map-layer': resource => [new EsriImageMapLayerPreviewer(resource)],
  'esri-tiled-map-layer': resource => [new EsriTiledMapLayerPreviewer(resource)],
  'wms': resource => [new WmsPreviewer(resource)],
  'wmts': resource => [new WmtsPreviewer(resource)],
  // deck.gl warps the COG as it draws it, so it can show one in any projection; the maplibre-cog-
  // protocol path in CogPreviewer only handles a COG already in Web Mercator. It is still exported
  // for the one thing it can do that this can't: carry an Authorization header. deck.gl fetches the
  // GeoTIFF through @developmentseed/geotiff, which offers no hook to reach those requests, so a
  // restricted COG needs CogPreviewer built by hand rather than this default.
  'cog': async resource => {
    const deck = await lazily(() => import('./cog-deck'), resource, 'COG');
    return [deck ?? new CogPreviewer(resource)];
  },

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

// Whether a resource is the record's own account of where it is, rather than something the record
// points at. The one resource whose preview depends on the others, so the one held back below.
const isLocation = (resource: Resource) => resource.kind === 'location';

/**
 * Every preview a list of resources offers, in the order they were given - which is the tab order.
 * Never rejects: this is awaited before the tabs are rendered, where a rejection would leave the
 * whole record without a preview rather than the one reference that failed.
 *
 * A location is the exception to that order, and goes last. It says where the record is, which is
 * worth a tab only when nothing else drew a map - a scan with no georeferencing to place it, or a
 * record with nothing previewable at all. Settled here rather than where the resources were built,
 * because a manifest is a map only if it turns out to be georeferenced and finding that out means
 * fetching it.
 */
export async function previewersForResources(resources: Resource[]): Promise<AnyPreviewer[]> {
  const previewers = (await Promise.all(resources.filter(resource => !isLocation(resource)).map(resource => previewersFor(resource)))).flat();

  // Something already draws the data on a map, so an outline of where that data is adds nothing
  if (previewers.some(previewer => previewer.renderer === 'map')) return previewers;

  const locations = await Promise.all(resources.filter(isLocation).map(resource => previewersFor(resource)));
  return [...previewers, ...locations.flat()];
}
