import type OgmRecord from '../record';
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
export function resourcesFor(record: OgmRecord): Resource[] {
  const { id, references, wxsIdentifier } = record;
  const bounds = record.getBounds();
  const resources: Resource[] = [];

  if (references.iiifImageUrl) resources.push(new IIIFResource(id, references.iiifImageUrl, bounds));
  if (references.iiifManifestUrl) resources.push(new IIIFManifestResource(id, references.iiifManifestUrl, bounds));
  if (references.pmtilesUrl) resources.push(new PMTilesResource(id, references.pmtilesUrl, bounds));
  if (references.tilejsonUrl) resources.push(new TileJsonResource(id, references.tilejsonUrl, bounds));
  if (references.indexMapUrl) resources.push(new OpenIndexMapResource(id, references.indexMapUrl, bounds));
  if (references.geojsonUrl) resources.push(new GeoJsonResource(id, references.geojsonUrl, bounds));
  if (references.esriFeatureLayerUrl) resources.push(new EsriFeatureLayerResource(id, references.esriFeatureLayerUrl, bounds));
  if (references.cogUrl) resources.push(new CogResource(id, references.cogUrl, bounds));
  if (references.tmsUrl) resources.push(new TmsResource(id, references.tmsUrl, bounds));
  if (references.xyzUrl) resources.push(new XyzResource(id, references.xyzUrl, bounds));
  if (references.esriTiledMapLayerUrl) resources.push(new EsriTiledMapLayerResource(id, references.esriTiledMapLayerUrl, bounds));
  if (references.esriDynamicMapLayerUrl) resources.push(new EsriDynamicMapLayerResource(id, references.esriDynamicMapLayerUrl, bounds));
  if (references.esriImageMapLayerUrl) resources.push(new EsriImageMapLayerResource(id, references.esriImageMapLayerUrl, bounds));

  // A WxS endpoint is a catalogue; without an identifier we don't know which layer of it to ask for
  if (references.wmtsUrl && wxsIdentifier) resources.push(new WmtsResource(id, references.wmtsUrl, { layerIds: [wxsIdentifier] }, bounds));
  if (references.wmsUrl && wxsIdentifier) resources.push(new WmsResource(id, references.wmsUrl, { layerIds: [wxsIdentifier] }, bounds));

  return resources;
}
