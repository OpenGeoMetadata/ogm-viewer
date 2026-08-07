import { describe, it, expect } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';

import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../record';
import { resourcesFor } from './factory';
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
import OpenIndexMapResource from './openindexmap';
import PMTilesResource from './pmtiles';
import TileJsonResource from './tilejson';
import TmsResource from './tms';
import WmsResource from './wms';
import WmtsResource from './wmts';
import XyzResource from './xyz';

// A minimal Aardvark record carrying the given references
const buildRecord = (references: Record<string, string>, extra: Partial<GeoBlacklightSchemaAardvark> = {}) =>
  new OgmRecord({
    id: 'berkeley-s7sq63',
    dct_title_s: 'Calaveras County Contours',
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    dct_references_s: JSON.stringify(references),
    ...extra,
  });

// Every reference the factory knows how to build something from, with the class it builds and the
// kind that class reports itself as - which is what chooses the previewer downstream
const REFERENCES: [string, string, new (...args: never[]) => Resource, ResourceKind][] = [
  ['http://iiif.io/api/image', 'https://example.com/iiif/info.json', IIIFResource, 'iiif-image'],
  ['http://iiif.io/api/presentation#manifest', 'https://example.com/manifest.json', IIIFManifestResource, 'iiif-manifest'],
  ['https://github.com/protomaps/PMTiles', 'https://example.com/tiles.pmtiles', PMTilesResource, 'pmtiles'],
  ['https://github.com/mapbox/tilejson-spec', 'https://example.com/tiles.json', TileJsonResource, 'tilejson'],
  ['https://openindexmaps.org', 'https://example.com/index.json', OpenIndexMapResource, 'openindexmap'],
  ['http://geojson.org/geojson-spec.html', 'https://example.com/data.json', GeoJsonResource, 'geojson'],
  ['urn:x-esri:serviceType:ArcGIS#FeatureLayer', 'https://example.com/arcgis/0', EsriFeatureLayerResource, 'esri-feature-layer'],
  ['https://github.com/cogeotiff/cog-spec', 'https://example.com/scan.tif', CogResource, 'cog'],
  ['https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification', 'https://example.com/tms', TmsResource, 'tms'],
  ['https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames', 'https://example.com/{z}/{x}/{y}.png', XyzResource, 'xyz'],
  ['urn:x-esri:serviceType:ArcGIS#TiledMapLayer', 'https://example.com/arcgis/tiled', EsriTiledMapLayerResource, 'esri-tiled-map-layer'],
  ['urn:x-esri:serviceType:ArcGIS#DynamicMapLayer', 'https://example.com/arcgis/dynamic', EsriDynamicMapLayerResource, 'esri-dynamic-map-layer'],
  ['urn:x-esri:serviceType:ArcGIS#ImageMapLayer', 'https://example.com/arcgis/image', EsriImageMapLayerResource, 'esri-image-map-layer'],
  ['http://www.opengis.net/def/serviceType/ogc/wmts', 'https://example.com/geoserver/wmts', WmtsResource, 'wmts'],
  ['http://www.opengis.net/def/serviceType/ogc/wms', 'https://example.com/geoserver/wms', WmsResource, 'wms'],
];

describe('resourcesFor', () => {
  it.each(REFERENCES)('builds a resource for the %s reference', (uri, url, expected, kind) => {
    // The WxS services need an identifier before they'll yield anything; see below
    const record = buildRecord({ [uri]: url }, { gbl_wxsIdentifier_s: 's7sq63' });
    const resources = resourcesFor(record);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toBeInstanceOf(expected);
    expect(resources[0].url).toEqual(url);
    expect(resources[0].id).toEqual('berkeley-s7sq63');

    // A subclass that forgot to override this would be previewed as whatever its parent is: an
    // index map as plain GeoJSON, a manifest as a single image
    expect(resources[0].kind).toEqual(kind);
  });

  // This order is the tab order, which is the only reason it matters that it's stable
  it('offers resources in the order they should be presented', () => {
    const record = buildRecord(Object.fromEntries(REFERENCES.map(([uri, url]) => [uri, url])), { gbl_wxsIdentifier_s: 's7sq63' });

    expect(resourcesFor(record).map(resource => resource.constructor)).toEqual(REFERENCES.map(([, , expected]) => expected));
  });

  it('offers nothing for a record with no previewable references', () => {
    expect(resourcesFor(buildRecord({ 'http://schema.org/downloadUrl': 'https://example.com/data.zip' }))).toEqual([]);
  });

  // A WxS endpoint is a catalogue, so without an identifier we don't know what to ask it for
  it.each(['http://www.opengis.net/def/serviceType/ogc/wms', 'http://www.opengis.net/def/serviceType/ogc/wmts'])(
    'skips the %s reference when the record names no layer within it',
    uri => {
      expect(resourcesFor(buildRecord({ [uri]: 'https://example.com/geoserver' }))).toEqual([]);
    },
  );

  // Asserted through XYZ, which reports back exactly the bounds it was handed. Resources that can
  // work their own extent out - a PMTiles header, a GeoJSON document - go and read it when the
  // record didn't say, and that fallback is theirs to test, not the factory's.
  describe('bounds', () => {
    const xyzReference = { 'https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames': 'https://example.com/{z}/{x}/{y}.png' };

    it("hands each resource the record's bounding box", async () => {
      const record = buildRecord(xyzReference, { dcat_bbox: 'ENVELOPE(-120.6,-120.0,38.5,38.0)' });
      const [resource] = resourcesFor(record);

      expect(await resource.getBounds()).toEqual(new LngLatBounds([-120.6, 38.0], [-120.0, 38.5]));
    });

    it('leaves the bounds unset when the record has no bounding box', async () => {
      const [resource] = resourcesFor(buildRecord(xyzReference));

      expect(await resource.getBounds()).toBeUndefined();
    });
  });

  // Threaded to every resource kind the same way bounds is; each resource's own tests cover what
  // it does with it, so one representative of each constructor shape is enough here.
  describe('requestTransform', () => {
    const transform = () => undefined;

    it('hands a plain resource its transform', () => {
      const reference = { 'http://geojson.org/geojson-spec.html': 'https://example.com/data.json' };
      const [resource] = resourcesFor(buildRecord(reference), transform);

      expect(resource.requestTransform).toBe(transform);
    });

    it('hands a WxS resource its transform', () => {
      const reference = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'https://example.com/geoserver/wms' };
      const record = buildRecord(reference, { gbl_wxsIdentifier_s: 's7sq63' });
      const [resource] = resourcesFor(record, transform);

      expect(resource.requestTransform).toBe(transform);
    });

    it('leaves it undefined when the caller does not pass one', () => {
      const reference = { 'http://geojson.org/geojson-spec.html': 'https://example.com/data.json' };
      const [resource] = resourcesFor(buildRecord(reference));

      expect(resource.requestTransform).toBeUndefined();
    });
  });
});
