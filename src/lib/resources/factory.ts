import type OgmRecord from '../record';
import type { RequestTransform } from '../request';
import type Resource from './resource';
import type { ResourceKind } from './resource';

import CogResource from './cog';
import EsriDynamicMapLayerResource from './esri-dynamic-map-layer';
import EsriFeatureLayerResource from './esri-feature-layer';
import EsriImageMapLayerResource from './esri-image-map-layer';
import EsriTiledMapLayerResource from './esri-tiled-map-layer';
import GeoJsonResource from './geojson';
import IIIFResource from './iiif';
import IIIFManifestResource from './iiif-manifest';
import LocationResource from './location';
import OpenIndexMapResource from './openindexmap';
import PMTilesResource from './pmtiles';
import TileJsonResource from './tilejson';
import TmsResource from './tms';
import WmsResource from './wms';
import WmtsResource from './wmts';
import XyzResource from './xyz';

const MAY_NOT_DRAW_A_MAP: ResourceKind[] = ['iiif-image', 'iiif-manifest'];

export function resourcesFor(record: OgmRecord, requestTransform?: RequestTransform): Resource[] {
  const { id, references, wxsIdentifier } = record;
  const bounds = record.getBounds();
  const resources: Resource[] = [];

  if (references.iiifImageUrl) resources.push(new IIIFResource(id, references.iiifImageUrl, bounds, requestTransform));
  // An annotation supplies control points, so attach it to an image resource rather than a tab of its own.
  if (references.iiifManifestUrl) resources.push(new IIIFManifestResource(id, references.iiifManifestUrl, bounds, requestTransform, references.georeferenceUrl));
  if (references.indexMapUrl) resources.push(new OpenIndexMapResource(id, references.indexMapUrl, bounds, requestTransform, references.fgdcUrl));
  if (references.pmtilesUrl) resources.push(new PMTilesResource(id, references.pmtilesUrl, bounds, requestTransform));
  if (references.tilejsonUrl) resources.push(new TileJsonResource(id, references.tilejsonUrl, bounds, requestTransform));
  if (references.geojsonUrl) resources.push(new GeoJsonResource(id, references.geojsonUrl, bounds, requestTransform));
  if (references.esriFeatureLayerUrl) resources.push(new EsriFeatureLayerResource(id, references.esriFeatureLayerUrl, bounds, requestTransform));
  if (references.cogUrl) resources.push(new CogResource(id, references.cogUrl, bounds, requestTransform, references.fgdcUrl));
  if (references.tmsUrl) resources.push(new TmsResource(id, references.tmsUrl, bounds, requestTransform));
  if (references.xyzUrl) resources.push(new XyzResource(id, references.xyzUrl, bounds, requestTransform));
  if (references.esriTiledMapLayerUrl) resources.push(new EsriTiledMapLayerResource(id, references.esriTiledMapLayerUrl, bounds, requestTransform));
  if (references.esriDynamicMapLayerUrl) resources.push(new EsriDynamicMapLayerResource(id, references.esriDynamicMapLayerUrl, bounds, requestTransform));
  if (references.esriImageMapLayerUrl) resources.push(new EsriImageMapLayerResource(id, references.esriImageMapLayerUrl, bounds, requestTransform));

  if (references.wmtsUrl && wxsIdentifier) resources.push(new WmtsResource(id, references.wmtsUrl, { layerIds: [wxsIdentifier] }, bounds, requestTransform));
  if (references.wmsUrl && wxsIdentifier) resources.push(new WmsResource(id, references.wmsUrl, { layerIds: [wxsIdentifier] }, bounds, requestTransform));

  if (resources.every(resource => MAY_NOT_DRAW_A_MAP.includes(resource.kind))) {
    const geometry = record.getGeometry();
    if (geometry) resources.push(new LocationResource(id, geometry as GeoJSON.Geometry));
  }

  return resources;
}
