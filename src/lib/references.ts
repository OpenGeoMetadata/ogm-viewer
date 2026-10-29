export const REFERENCE_URIS = {
  'https://github.com/cogeotiff/cog-spec': 'COG',
  'http://lccn.loc.gov/sh85035852': 'Data dictionary',
  'http://schema.org/downloadUrl': 'Download URL',
  'http://geojson.org/geojson-spec.html': 'GeoJSON',
  'http://schema.org/url': 'Layer description',
  'http://iiif.io/api/image': 'IIIF image',
  'http://iiif.io/api/presentation#manifest': 'IIIF manifest',
  'https://iiif.io/api/extension/georef/1/context.json': 'IIIF georeference annotation',
  'http://www.opengis.net/cat/csw/csdgm': 'FGDC metadata',
  'http://www.w3.org/1999/xhtml': 'HTML metadata',
  'http://www.isotc211.org/schemas/2005/gmd': 'ISO 19139 metadata',
  'http://www.isotc211.org/schemas/2005/gco': 'ISO 19110 metadata',
  'http://www.loc.gov/mods/v3': 'MODS metadata',
  'https://oembed.com': 'OEmbed',
  'https://openindexmaps.org': 'Index map',
  'https://github.com/protomaps/PMTiles': 'PMTiles',
  'https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification': 'TMS',
  'https://github.com/mapbox/tilejson-spec': 'TileJSON',
  'http://www.opengis.net/def/serviceType/ogc/wcs': 'WCS',
  'http://www.opengis.net/def/serviceType/ogc/wms': 'WMS',
  'http://www.opengis.net/def/serviceType/ogc/wfs': 'WFS',
  'http://www.opengis.net/def/serviceType/ogc/wmts': 'WMTS',
  'https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames': 'XYZ tiles',
  'urn:x-esri:serviceType:ArcGIS#DynamicMapLayer': 'ArcGIS Dynamic Map Layer',
  'urn:x-esri:serviceType:ArcGIS#FeatureLayer': 'ArcGIS Feature Layer',
  'urn:x-esri:serviceType:ArcGIS#ImageMapLayer': 'ArcGIS Image Map Layer',
  'urn:x-esri:serviceType:ArcGIS#TiledMapLayer': 'ArcGIS Tiled Map Layer',
} as const;

export type ReferenceURI = keyof typeof REFERENCE_URIS;
export type ReferenceName = (typeof REFERENCE_URIS)[ReferenceURI];

const METADATA_REFERENCE_URIS = [
  'http://schema.org/url',
  'http://www.opengis.net/cat/csw/csdgm',
  'http://www.w3.org/1999/xhtml',
  'http://www.isotc211.org/schemas/2005/gmd',
  'http://www.isotc211.org/schemas/2005/gco',
  'http://www.loc.gov/mods/v3',
  'http://lccn.loc.gov/sh85035852',
] as const;

const canonicalUri = (uri: string): string => uri.replace(/\/+$/, '');

function canonicalizeKeys(parsed: unknown): ReferencesRecord {
  if (!parsed || typeof parsed !== 'object') return {};

  const canonicalized: Record<string, unknown> = {};
  for (const [uri, value] of Object.entries(parsed)) {
    const key = canonicalUri(uri);
    if (!(key in canonicalized)) canonicalized[key] = value;
  }

  return canonicalized as ReferencesRecord;
}

export type LabelledLinks = { url: string; label: string }[];
type NonDownloadReferenceURI = Exclude<ReferenceURI, 'http://schema.org/downloadUrl'>;
type DownloadReference = { 'http://schema.org/downloadUrl': string | LabelledLinks };

export type ReferencesRecord = Partial<{ [key in NonDownloadReferenceURI]: string } & DownloadReference>;

export class References {
  private references: ReferencesRecord;

  constructor(dct_references_s: string) {
    try {
      this.references = canonicalizeKeys(JSON.parse(dct_references_s));
    } catch (error) {
      console.error('Failed to parse references:', error);
      this.references = {};
    }
  }

  get wmsUrl() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wms'];
  }

  get cogUrl() {
    return this.references['https://github.com/cogeotiff/cog-spec'];
  }

  get tmsUrl() {
    return this.references['https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification'];
  }

  get xyzUrl() {
    return this.references['https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames'];
  }

  get geojsonUrl() {
    return this.references['http://geojson.org/geojson-spec.html'];
  }

  get tilejsonUrl() {
    return this.references['https://github.com/mapbox/tilejson-spec'];
  }

  get indexMapUrl() {
    return this.references['https://openindexmaps.org'];
  }

  get pmtilesUrl() {
    return this.references['https://github.com/protomaps/PMTiles'];
  }

  get wmtsUrl() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wmts'];
  }

  get iiifImageUrl() {
    return this.references['http://iiif.io/api/image'];
  }

  get iiifManifestUrl() {
    return this.references['http://iiif.io/api/presentation#manifest'];
  }

  get georeferenceUrl() {
    return this.references['https://iiif.io/api/extension/georef/1/context.json'];
  }

  get esriDynamicMapLayerUrl() {
    return this.references['urn:x-esri:serviceType:ArcGIS#DynamicMapLayer'];
  }

  get esriFeatureLayerUrl() {
    return this.references['urn:x-esri:serviceType:ArcGIS#FeatureLayer'];
  }

  get esriImageMapLayerUrl() {
    return this.references['urn:x-esri:serviceType:ArcGIS#ImageMapLayer'];
  }

  get esriTiledMapLayerUrl() {
    return this.references['urn:x-esri:serviceType:ArcGIS#TiledMapLayer'];
  }

  get fgdcUrl() {
    return this.references['http://www.opengis.net/cat/csw/csdgm'];
  }

  get iso19110Url() {
    return this.references['http://www.isotc211.org/schemas/2005/gco'];
  }

  get downloadLinks(): LabelledLinks {
    const fieldContents = this.references['http://schema.org/downloadUrl'];
    if (!fieldContents) return [];
    if (Array.isArray(fieldContents)) return fieldContents;
    return [];
  }

  get downloadUrl(): string | undefined {
    const fieldContents = this.references['http://schema.org/downloadUrl'];
    if (typeof fieldContents === 'string') return fieldContents;
    return;
  }

  get metadataLinks(): LabelledLinks {
    return METADATA_REFERENCE_URIS.flatMap(uri => {
      const url = this.references[uri];
      return typeof url === 'string' ? [{ url, label: REFERENCE_URIS[uri] }] : [];
    });
  }

  get previewable() {
    return this.previewableReferences.some(Boolean);
  }

  get mapPreviewable() {
    return this.mapPreviewableReferences.some(Boolean);
  }

  get iiifPreviewable() {
    return this.iiifReferences.some(Boolean);
  }

  get iiifOnly() {
    return !this.mapPreviewable && this.iiifPreviewable;
  }

  private get previewableReferences() {
    return this.mapPreviewableReferences.concat(this.iiifReferences);
  }

  private get mapPreviewableReferences() {
    return [
      this.wmsUrl,
      this.cogUrl,
      this.tmsUrl,
      this.xyzUrl,
      this.geojsonUrl,
      this.tilejsonUrl,
      this.indexMapUrl,
      this.pmtilesUrl,
      this.wmtsUrl,
      this.esriDynamicMapLayerUrl,
      this.esriFeatureLayerUrl,
      this.esriImageMapLayerUrl,
      this.esriTiledMapLayerUrl,
      ...this.georeferenceReferences,
    ];
  }

  private get georeferenceReferences() {
    return this.georeferenceUrl && this.iiifPreviewable ? [this.georeferenceUrl] : [];
  }

  private get iiifReferences() {
    return [this.iiifImageUrl, this.iiifManifestUrl];
  }
}
