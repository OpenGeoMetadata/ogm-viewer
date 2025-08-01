import { References } from './references';
import { bboxToBounds, boundsToGeoJSON, geomToGeoJSON } from './geometry';

/**
 * Schema for GeoBlacklight. See https://opengeometadata.github.io/aardvark/aardvarkMetadata.html for more details.
 */
export interface GeoBlacklightSchemaAardvark {
  dct_title_s: string;
  dct_alternative_sm?: string[];
  dct_description_sm?: string[];
  dct_language_sm?: string[];
  gbl_displayNote_sm?: string[];
  dct_creator_sm?: string[];
  dct_publisher_sm?: string[];
  schema_provider_s?: string;
  gbl_resourceClass_sm: ('Datasets' | 'Maps' | 'Imagery' | 'Collections' | 'Websites' | 'Web services' | 'Other')[];
  gbl_resourceType_sm?: string[];
  dct_subject_sm?: string[];
  dcat_theme_sm?: string[];
  dcat_keyword_sm?: string[];
  dct_temporal_sm?: string[];
  dct_issued_s?: string;
  gbl_indexYear_im?: number[];
  gbl_dateRange_drsim?: string[];
  dct_spatial_sm?: string[];
  locn_geometry?: string;
  dcat_bbox?: string;
  dcat_centroid?: string;
  dct_relation_sm?: string[];
  pcdm_memberOf_sm?: string[];
  dct_isPartOf_sm?: string[];
  dct_source_sm?: string[];
  dct_isVersionOf_sm?: string[];
  dct_replaces_sm?: string[];
  dct_isReplacedBy_sm?: string[];
  dct_rights_sm?: string[];
  dct_rightsHolder_sm?: string[];
  dct_license_sm?: string[];
  dct_accessRights_s: 'Public' | 'Restricted';
  dct_format_s?: string;
  gbl_fileSize_s?: string;
  gbl_wxsIdentifier_s?: string;
  dct_references_s?: string;
  id: string;
  dct_identifier_sm?: string[];
  gbl_mdModified_dt?: string;
  gbl_mdVersion_s: 'Aardvark';
  gbl_suppressed_b?: boolean;
  gbl_georeferenced_b?: boolean;
  [k: string]: unknown;
}

/**
 * These are used to map the keys in the record to more user-friendly names.
 */
export const OGM_FIELD_NAMES = {
  id: 'ID',
  title: 'Title',
  description: 'Description',
  resourceType: 'Resource Type',
  resourceClass: 'Resource Class',
  accessRights: 'Access Rights',
  references: 'References',
  identifier: 'Identifier',
  wxsIdentifier: 'WxS Identifier',
  alternativeTitles: 'Alternative Title',
  language: 'Language',
  displayNotes: 'Display Notes',
  creators: 'Creator',
  publishers: 'Publisher',
  provider: 'Provider',
  themes: 'Theme',
  keywords: 'Keywords',
  temporal: 'Temporal Coverage',
  issued: 'Date Issued',
  indexYear: 'Index Year',
  dateRange: 'Date Range',
  spatial: 'Spatial Coverage',
  geometry: 'Geometry',
  bbox: 'Bounding Box',
  centroid: 'Centroid',
  relations: 'Relation',
  memberOf: 'Member Of',
  isPartOf: 'Is Part Of',
  source: 'Source',
  isVersionOf: 'Is Version Of',
  replaces: 'Replaces',
  isReplacedBy: 'Is Replaced By',
  rights: 'Rights',
  rightsHolder: 'Rights Holder',
  license: 'License',
  fileSize: 'File Size',
  mdModified: 'Modified',
  suppressed: 'Suppressed',
  georeferenced: 'Georeferenced',
  subjects: 'Subject',
  mdVersion: 'Metadata Version',
  format: 'Format',
};

/**
 * Class for representing an OGM Aardvark record parsed from JSON data.
 */
export class OgmRecord {
  // Original JSON data
  json: GeoBlacklightSchemaAardvark;

  // Required
  id: string;
  title: string;
  resourceClass: string[];
  accessRights: 'Public' | 'Restricted';
  mdVersion = 'Aardvark';

  // Optional
  references: References;
  identifier?: string[];
  wxsIdentifier?: string;
  alternativeTitles?: string[];
  description?: string[];
  language?: string[];
  displayNotes?: string[];
  creators?: string[];
  publishers?: string[];
  provider?: string;
  resourceType?: string[];
  themes?: string[];
  keywords?: string[];
  temporal?: string[];
  issued?: string;
  indexYear?: number[];
  dateRange?: string[];
  spatial?: string[];
  geometry?: string;
  bbox?: string;
  centroid?: string;
  relations?: string[];
  memberOf?: string[];
  isPartOf?: string[];
  source?: string[];
  isVersionOf?: string[];
  replaces?: string[];
  isReplacedBy?: string[];
  rights?: string[];
  rightsHolder?: string[];
  license?: string[];
  fileSize?: string;
  mdModified?: string;
  suppressed?: boolean;
  georeferenced?: boolean;
  subjects?: string[];
  format?: string;

  constructor(data: GeoBlacklightSchemaAardvark) {
    if (data.gbl_mdVersion_s !== 'Aardvark') {
      throw new Error('Unsupported metadata version: ' + data.gbl_mdVersion_s);
    }

    // Copy fields with friendlier names
    this.id = data.id;
    this.title = data.dct_title_s;
    this.wxsIdentifier = data.gbl_wxsIdentifier_s;
    this.subjects = data.dct_subject_sm;
    this.resourceClass = data.gbl_resourceClass_sm;
    this.resourceType = data.gbl_resourceType_sm;
    this.rights = data.dct_rights_sm;
    this.rightsHolder = data.dct_rightsHolder_sm;
    this.license = data.dct_license_sm;
    this.accessRights = data.dct_accessRights_s;
    this.identifier = data.dct_identifier_sm;
    this.wxsIdentifier = data.gbl_wxsIdentifier_s;
    this.alternativeTitles = data.dct_alternative_sm;
    this.description = data.dct_description_sm;
    this.language = data.dct_language_sm;
    this.displayNotes = data.gbl_displayNote_sm;
    this.creators = data.dct_creator_sm;
    this.publishers = data.dct_publisher_sm;
    this.provider = data.schema_provider_s;
    this.resourceType = data.gbl_resourceType_sm;
    this.themes = data.dcat_theme_sm;
    this.keywords = data.dcat_keyword_sm;
    this.temporal = data.dct_temporal_sm;
    this.issued = data.dct_issued_s;
    this.indexYear = data.gbl_indexYear_im;
    this.dateRange = data.gbl_dateRange_drsim;
    this.spatial = data.dct_spatial_sm;
    this.geometry = data.locn_geometry;
    this.bbox = data.dcat_bbox;
    this.centroid = data.dcat_centroid;
    this.format = data.dct_format_s;
    this.fileSize = data.gbl_fileSize_s;

    // Parse references from JSON string
    this.references = new References(data.dct_references_s || '{}');

    // Save original JSON data
    this.json = data;
  }

  // Record is restricted if access rights are 'Restricted'
  get restricted() {
    return this.accessRights === 'Restricted';
  }

  // String used for attribution of map layers.
  get attribution() {
    if (this.rightsHolder && this.rightsHolder.length > 0) return this.rightsHolder.join('; ');
    if (this.publishers && this.publishers.length > 0) return this.publishers.join('; ');
    if (this.provider) return this.provider;
  }

  // List of download links with URL and label
  get downloadLinks() {
    return this.references.downloadLinks.map(link => {
      // If no label for download, use the format, falling back to 'Object'
      // If file size is available, append it to the label
      if (!link.label) link.label = this.format || 'Object';
      if (this.fileSize) link.label += ` (${this.fileSize})`;
      return link;
    });
  }

  // Get the bounding box as LngLatBounds
  getBounds() {
    if (!this.bbox) return null;
    return bboxToBounds(this.bbox);
  }

  // Get the geometry as a GeoJSON Polygon
  getGeometry() {
    // Try locn_geometry first in case we have complex WKT geometry
    if (this.geometry) {
      const geojson = geomToGeoJSON(this.geometry);
      if (geojson) return geojson;
    }

    // If no locn_geometry, fall back to dcat_bbox with ENVELOPE
    if (this.bbox) {
      const bounds = this.getBounds();
      if (bounds) return boundsToGeoJSON(bounds);
    }
  }
}
