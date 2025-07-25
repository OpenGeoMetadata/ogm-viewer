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
}
