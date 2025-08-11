import iiif3 from '@iiif/presentation-3';
import iiif2 from '@iiif/presentation-2'

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

  // Cache for fetched IIIF manifest
  iiifManifest: iiif3.Manifest | iiif2.Manifest | null;

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
  get wmsUrl() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wms'];
  }

  // The cloud-optimized GeoTIFF URL, if any
  get cogUrl() {
    return this.references['https://github.com/cogeotiff/cog-spec'];
  }

  // The TMS URL, if any
  get tmsUrl() {
    return this.references['https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification'];
  }

  // The XYZ tiles URL, if any
  get xyzUrl() {
    return this.references['https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames'];
  }

  // The GeoJSON URL, if any
  get geojsonUrl() {
    return this.references['http://geojson.org/geojson-spec.html'];
  }

  // The TileJSON URL, if any
  get tilejsonUrl() {
    return this.references['https://tilejson.org/specification/2.2.0/schema.json'];
  }

  // The Index map URL, if any
  get indexMapUrl() {
    return this.references['https://openindexmaps.org'];
  }

  // The PMTiles URL, if any
  get pmtilesUrl() {
    return this.references['https://pmtiles.org'];
  }

  // The WMTS URL, if any
  get wmtsUrl() {
    return this.references['http://www.opengis.net/def/serviceType/ogc/wmts'];
  }

  // The IIIF image URL, if any
  get iiifImageUrl() {
    return this.references['http://iiif.io/api/image'];
  }

  // The IIIF manifest URL, if any
  get iiifManifestUrl() {
    return this.references['http://iiif.io/api/presentation#manifest'];
  }

  async iiifImages() {
    if (this.iiifImageUrl) return [this.iiifImageUrl];
    if (!this.iiifManifest && this.iiifManifestUrl) await this.fetchManifest();
    if (!this.iiifManifest) return [];
    if (this.iiifVersion == 3) return this.extractIiif3ImageUrls(this.iiifManifest as iiif3.Manifest);
    if (this.iiifVersion == 2) return this.extractIiif2ImageUrls(this.iiifManifest as iiif2.Manifest);
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
    return [this.wmsUrl, this.cogUrl, this.tmsUrl, this.xyzUrl, this.geojsonUrl, this.tilejsonUrl, this.indexMapUrl, this.pmtilesUrl, this.wmtsUrl];
  }

  // Get all IIIF references (image and manifest)
  private get iiifReferences() {
    return [this.iiifImageUrl, this.iiifManifestUrl];
  }

  // Get the IIIF presentation spec version of the manifest, if we have one
  private get iiifVersion() {
    if (!this.iiifManifest) return null;
    return this.iiifManifest['@context']?.includes('http://iiif.io/api/presentation/3/context.json') ? 3 : 2;
  }

  // Given a v2 manifest, extract all of the IIIF images and format as info.json URLs
  private extractIiif2ImageUrls(manifest: iiif2.Manifest): string[] {
    return manifest.sequences
      .flatMap((seq) => seq.canvases)
      .flatMap((can) => can.images)
      .flatMap((img) => img.resource)
      .flatMap((res) => (res['@type'] === 'dctypes:Image' ? res.service['@id'] + '/info.json' : []));
  }

  // Given a v3 manifest, extract all of the IIIF images and format as info.json URLs
  private extractIiif3ImageUrls(manifest: iiif3.Manifest): string[] {
    // Recursively search the '.items' key until we end up with nodes that have type 'ImageService2'
    return manifest.items
      .flatMap((canvas) => canvas.items)
      .flatMap((annotationPage) => annotationPage.items)
      .flatMap((annotation) => {
        if (annotation.body instanceof Array) {
          return annotation.body
        }
        else {
          return [annotation.body]
        }
      })
      //@ts-ignore
      .flatMap(annotationBody => annotationBody.service)
      .flatMap(service => service.id + '/info.json')
  }

  // TODO: use navPlace as the bounds source if available

  // Attempt to fetch and parse the IIIF manifest, if any
  async fetchManifest(): Promise<iiif2.Manifest | iiif3.Manifest | null> {
    if (!this.iiifManifestUrl) return null;

    try {
      const response = await fetch(this.iiifManifestUrl);
      if (!response.ok) throw new Error(`Unexpected response fetching IIIF manifest: ${response.statusText}`);
      const manifest = await response.json();
      this.iiifManifest = manifest;
      return manifest;
    } catch (error) {
      console.error(error.message);
      this.iiifManifest = null;
      return null;
    }
  }
}
