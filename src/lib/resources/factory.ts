import type OgmRecord from '../record';
import type { RequestTransform } from '../request';
import type Resource from './resource';

import CogResource from './cog';
import EsriDynamicMapLayerResource from './esri-dynamic-map-layer';
import EsriFeatureLayerResource from './esri-feature-layer';
import EsriImageMapLayerResource from './esri-image-map-layer';
import EsriTiledMapLayerResource from './esri-tiled-map-layer';
import GeoJsonResource from './geojson';
import IIIFResource from './iiif';
import IIIFManifestResource from './iiif-manifest';
import OpenIndexMapResource from './openindexmap';
import PMTilesResource from './pmtiles';
import TileJsonResource from './tilejson';
import TmsResource from './tms';
import WmsResource from './wms';
import WmtsResource from './wmts';
import XyzResource from './xyz';

/**
 * Every previewable resource a record's references point at, in the order they're offered to the
 * user - this list is the tab order.
 */
export function resourcesFor(record: OgmRecord, requestTransform?: RequestTransform): Resource[] {
  const { id, references, wxsIdentifier } = record;
  const bounds = record.getBounds();
  const resources: Resource[] = [];

  if (references.iiifImageUrl) resources.push(new IIIFResource(id, references.iiifImageUrl, bounds, requestTransform));
  // A georeference annotation gets no resource of its own: on its own it draws nothing, being only
  // a set of control points for an image held elsewhere. It goes to the manifest instead, which
  // offers a second, map preview of itself when either source turns out to have one.
  if (references.iiifManifestUrl) resources.push(new IIIFManifestResource(id, references.iiifManifestUrl, bounds, requestTransform, references.georeferenceUrl));
  if (references.pmtilesUrl) resources.push(new PMTilesResource(id, references.pmtilesUrl, bounds, requestTransform));
  if (references.tilejsonUrl) resources.push(new TileJsonResource(id, references.tilejsonUrl, bounds, requestTransform));
  if (references.indexMapUrl) resources.push(new OpenIndexMapResource(id, references.indexMapUrl, bounds, requestTransform));
  if (references.geojsonUrl) resources.push(new GeoJsonResource(id, references.geojsonUrl, bounds, requestTransform));
  if (references.esriFeatureLayerUrl) resources.push(new EsriFeatureLayerResource(id, references.esriFeatureLayerUrl, bounds, requestTransform));
  if (references.cogUrl) resources.push(new CogResource(id, references.cogUrl, bounds, requestTransform));
  if (references.tmsUrl) resources.push(new TmsResource(id, references.tmsUrl, bounds, requestTransform));
  if (references.xyzUrl) resources.push(new XyzResource(id, references.xyzUrl, bounds, requestTransform));
  if (references.esriTiledMapLayerUrl) resources.push(new EsriTiledMapLayerResource(id, references.esriTiledMapLayerUrl, bounds, requestTransform));
  if (references.esriDynamicMapLayerUrl) resources.push(new EsriDynamicMapLayerResource(id, references.esriDynamicMapLayerUrl, bounds, requestTransform));
  if (references.esriImageMapLayerUrl) resources.push(new EsriImageMapLayerResource(id, references.esriImageMapLayerUrl, bounds, requestTransform));

  // A WxS endpoint is a catalogue; without an identifier we don't know which layer of it to ask for
  if (references.wmtsUrl && wxsIdentifier) resources.push(new WmtsResource(id, references.wmtsUrl, { layerIds: [wxsIdentifier] }, bounds, requestTransform));
  if (references.wmsUrl && wxsIdentifier) resources.push(new WmsResource(id, references.wmsUrl, { layerIds: [wxsIdentifier] }, bounds, requestTransform));

  return resources;
}
