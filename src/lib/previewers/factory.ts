import type EsriFeatureLayerResource from '../resources/esri-feature-layer';
import type IIIFManifestResource from '../resources/iiif-manifest';
import type MapResource from '../resources/map';
import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import type MapPreviewer from './map';

import EsriDynamicMapLayerPreviewer from './esri-dynamic-map-layer';
import EsriFeatureLayerPreviewer from './esri-feature-layer';
import EsriTiledFeatureLayerPreviewer from './esri-tiled-feature-layer';
import EsriImageMapLayerPreviewer from './esri-image-map-layer';
import EsriTiledMapLayerPreviewer from './esri-tiled-map-layer';
import GeoJsonPreviewer from './geojson';
import ImagePreviewer from './image';
import LocationPreviewer from './location';
import OpenIndexMapPreviewer from './openindexmap';
import PMTilesRasterPreviewer from './pmtiles-raster';
import PMTilesVectorPreviewer from './pmtiles-vector';
import TileJsonRasterPreviewer from './tilejson-raster';
import TileJsonVectorPreviewer from './tilejson-vector';
import WmsPreviewer from './wms';
import WmtsPreviewer from './wmts';
import XyzPreviewer from './xyz';

export type AnyPreviewer = MapPreviewer | ImagePreviewer;

type PreviewerBuilder = (resource: Resource) => AnyPreviewer[] | Promise<AnyPreviewer[]>;

const holdsVectors = async (resource: Resource): Promise<boolean> =>
  await (resource as MapResource).isVector().catch(error => {
    console.warn(`Could not tell whether ${resource.url} holds vector tiles:`, error);
    return false;
  });

const tilesFeatures = async (resource: Resource): Promise<boolean> =>
  await ((resource as EsriFeatureLayerResource).tilesFeatures?.() ?? Promise.resolve(false)).catch(error => {
    console.warn(`Could not tell whether ${resource.url} is too large to draw at once:`, error);
    return false;
  });

const lazily = async <T>(load: () => Promise<{ default: new (resource: Resource) => T }>, resource: Resource, what: string): Promise<T | undefined> => {
  try {
    const { default: Previewer } = await load();
    return new Previewer(resource);
  } catch (error) {
    console.warn(`Could not load the ${what} previewer for ${resource.url}:`, error);
    return undefined;
  }
};

const isGeoreferenced = async (resource: Resource): Promise<boolean> => {
  try {
    return await (resource as IIIFManifestResource).isGeoreferenced();
  } catch (error) {
    console.warn(`Could not tell whether ${resource.url} is georeferenced:`, error);
    return false;
  }
};

const BUILDERS: Record<ResourceKind, PreviewerBuilder> = {
  'iiif-image': resource => [new ImagePreviewer(resource)],

  'iiif-manifest': async resource => {
    const previewers: AnyPreviewer[] = [new ImagePreviewer(resource)];
    if (!(await isGeoreferenced(resource))) return previewers;

    const georeference = await lazily(() => import('./georeference'), resource, 'georeferenced map');
    return georeference ? [...previewers, georeference] : previewers;
  },

  'geojson': resource => [new GeoJsonPreviewer(resource)],
  'location': resource => [new LocationPreviewer(resource)],
  'openindexmap': resource => [new OpenIndexMapPreviewer(resource)],
  // Read small feature layers whole; query larger ones by tile to limit memory and request volume.
  'esri-feature-layer': async resource => [(await tilesFeatures(resource)) ? new EsriTiledFeatureLayerPreviewer(resource) : new EsriFeatureLayerPreviewer(resource)],
  'esri-dynamic-map-layer': resource => [new EsriDynamicMapLayerPreviewer(resource)],
  'esri-image-map-layer': resource => [new EsriImageMapLayerPreviewer(resource)],
  'esri-tiled-map-layer': resource => [new EsriTiledMapLayerPreviewer(resource)],
  'wms': resource => [new WmsPreviewer(resource)],
  'wmts': resource => [new WmtsPreviewer(resource)],
  'cog': async resource => {
    const cog = await lazily(() => import('./cog'), resource, 'COG');
    return cog ? [cog] : [];
  },
  'tms': resource => [new XyzPreviewer(resource)],
  'xyz': resource => [new XyzPreviewer(resource)],

  'pmtiles': async resource => [(await holdsVectors(resource)) ? new PMTilesVectorPreviewer(resource) : new PMTilesRasterPreviewer(resource)],
  'tilejson': async resource => [(await holdsVectors(resource)) ? new TileJsonVectorPreviewer(resource) : new TileJsonRasterPreviewer(resource)],
};

export async function previewersFor(resource: Resource): Promise<AnyPreviewer[]> {
  const builder = BUILDERS[resource.kind];

  if (!builder) {
    console.warn(`No preview for resource kind: ${resource.kind}`);
    return [];
  }

  return await builder(resource);
}

const isLocation = (resource: Resource) => resource.kind === 'location';

// Keep failed resources as error tabs so one broken service does not hide the remaining previews.
export async function previewersForResources(resources: Resource[]): Promise<AnyPreviewer[]> {
  const previewers = (await Promise.all(resources.filter(resource => !isLocation(resource)).map(resource => previewersFor(resource)))).flat();

  if (previewers.some(previewer => previewer.renderer === 'map')) return previewers;

  const locations = await Promise.all(resources.filter(isLocation).map(resource => previewersFor(resource)));
  return [...previewers, ...locations.flat()];
}
