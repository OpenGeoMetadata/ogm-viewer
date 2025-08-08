// Map reference URI keys to user-friendly names
export const REFERENCE_URIS = {
  'https://github.com/cogeotiff/cog-spec': 'COG',
  'http://lccn.loc.gov/sh85035852': 'Data dictionary',
  'http://schema.org/downloadUrl': 'Download URL',
  'http://geojson.org/geojson-spec.html': 'GeoJSON',
  'http://schema.org/url': 'Layer description',
  'http://iiif.io/api/image': 'IIIF image',
  'http://iiif.io/api/presentation#manifest': 'IIIF manifest',
  'http://www.opengis.net/cat/csw/csdgm': 'FGDC metadata',
  'http://www.w3.org/1999/xhtml': 'HTML metadata',
  'http://www.isotc211.org/schemas/2005/gmd/': 'ISO 19139 metadata',
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
} as const;

// Specific types for URI values and their friendly names
export type ReferenceURI = keyof typeof REFERENCE_URIS;
export type ReferenceName = (typeof REFERENCE_URIS)[ReferenceURI];

// References that are links to metadata
const METADATA_REFERENCE_URIS = [
  'http://schema.org/url',
  'http://www.opengis.net/cat/csw/csdgm',
  'http://www.w3.org/1999/xhtml',
  'http://www.isotc211.org/schemas/2005/gmd/',
  'http://www.loc.gov/mods/v3',
  'http://lccn.loc.gov/sh85035852',
];

// Special handling for download URLs, can be a single string or an array of objects
export type LabelledLinks = { url: string; label: string }[];
type NonDownloadReferenceURI = Exclude<ReferenceURI, 'http://schema.org/downloadUrl'>;
type DownloadReference = { 'http://schema.org/downloadUrl': string | LabelledLinks };

// Type for the complete references record, all keys are optional
export type ReferencesRecord = Partial<{ [key in NonDownloadReferenceURI]: string } & DownloadReference>;

// Class that encapsulates references functionality
export class References {
  // Underlying object to hold references
  private references: ReferencesRecord;

  // Create a new instance with the JSON string from a record
  constructor(dct_references_s: string) {
    try {
      this.references = JSON.parse(dct_references_s);
    } catch (error) {
      console.error('Failed to parse references:', error);
      this.references = {};
    }
  }

  // The WMS URL, if any
  get wms() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wms'];
  }

  // The cloud-optimized GeoTIFF URL, if any
  get cog() {
    return this.references['https://github.com/cogeotiff/cog-spec'];
  }

  // The TMS URL, if any
  get tms() {
    return this.references['https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification'];
  }

  // The XYZ tiles URL, if any
  get xyz() {
    return this.references['https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames'];
  }

  // The GeoJSON URL, if any
  get geojson() {
    return this.references['http://geojson.org/geojson-spec.html'];
  }

  // The TileJSON URL, if any
  get tilejson() {
    return this.references['https://tilejson.org/specification/2.2.0/schema.json'];
  }

  // The Index map URL, if any
  get indexMap() {
    return this.references['https://openindexmaps.org'];
  }

  // The PMTiles URL, if any
  get pmtiles() {
    return this.references['https://pmtiles.org'];
  }

  // The WMTS URL, if any
  get wmts() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wmts'];
  }

  // The IIIF image URL, if any
  get iiifImage() {
    return this.references['http://iiif.io/api/image'];
  }

  // The IIIF manifest URL, if any
  get iiifManifest() {
    return this.references['http://iiif.io/api/presentation#manifest'];
  }

  // List of download links with URL and label
  get downloadLinks(): LabelledLinks {
    const fieldContents = this.references['http://schema.org/downloadUrl'];
    if (!fieldContents) return [];
    if (Array.isArray(fieldContents)) return fieldContents;
    return [{ url: fieldContents, label: null }];
  }

  // List of metadata links with URL and label
  get metadataLinks(): LabelledLinks {
    return Object.entries(this.references)
      .filter(([uri]) => METADATA_REFERENCE_URIS.includes(uri))
      .map(([uri, url]: [ReferenceURI, string]) => ({ url, label: REFERENCE_URIS[uri] }));
  }

  // True if the record has at least one reference that can be rendered for preview
  get previewable() {
    return this.previewableReferences.some(Boolean);
  }

  // True if the record has a reference that can be rendered on a map
  get mapPreviewable() {
    return this.mapPreviewableReferences.some(Boolean);
  }

  // True if the record has any IIIF references (image or manifest)
  get iiifPreviewable() {
    return this.iiifReferences.some(Boolean);
  }

  // True if the record can only be previewed via IIIF references (image or manifest)
  get iiifOnly() {
    return !this.mapPreviewable && this.iiifPreviewable;
  }

  // Get all references that can be rendered for preview
  private get previewableReferences() {
    return this.mapPreviewableReferences.concat(this.iiifReferences);
  }

  // Get all references that can be rendered on a map
  private get mapPreviewableReferences() {
    return [this.wms, this.cog, this.tms, this.xyz, this.geojson, this.tilejson, this.indexMap, this.pmtiles, this.wmts];
  }

  // Get all IIIF references (image and manifest)
  private get iiifReferences() {
    return [this.iiifImage, this.iiifManifest];
  }
}
