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

// The kinds whose preview might turn out not to be a map. A scan is drawn on one only when it also
// says where on the earth it belongs, and that can't be settled here: a IIIF image never carries
// georeferencing, and a manifest only carries it sometimes, discoverable only by fetching it.
// Everything else below is a map by construction.
const MAY_NOT_DRAW_A_MAP: ResourceKind[] = ['iiif-image', 'iiif-manifest'];

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

  // Where the record says it is, for when nothing above will put it on a map - either because none
  // of it can be drawn at all, or because all of it is a scan with nothing to place it by. A reader
  // who can't see the data on a map still learns what part of the world it covers, which is most of
  // what they came to a map for. Its geometry rather than its bounding box: getGeometry() prefers
  // locn_geometry, which may describe a coastline or an archipelago that an envelope would claim far
  // more of the map than the record actually covers.
  //
  // Offered rather than decided, and last so that it is the last tab: whether a manifest is
  // georeferenced is only known once it has been read, so previewersForResources settles it and drops
  // this again if a map did turn up. A record with no geometry has nothing to offer either way.
  if (resources.every(resource => MAY_NOT_DRAW_A_MAP.includes(resource.kind))) {
    const geometry = record.getGeometry();
    if (geometry) resources.push(new LocationResource(id, geometry as GeoJSON.Geometry));
  }

  return resources;
}
