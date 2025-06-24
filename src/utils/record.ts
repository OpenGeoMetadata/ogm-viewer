import { ENVELOPE_REGEX } from "./utils";
import { LngLatBounds } from "maplibre-gl";

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
  dct_accessRights_s: string;
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
 * Class for representing an OGM Aardvark record parsed from JSON data.
 */
export class OgmRecord {
  // Required
  id: string;
  title: string;
  resourceClass: string[];
  accessRights: string;
  mdVersion: 'Aardvark';

  // Optional
  references: Record<string, string | Record<string, string>[]>;
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

    // Parse references from JSON string
    this.references = JSON.parse(data.dct_references_s);
  }

  // Convert ENVELOPE syntax to LngLatBounds
  getBounds() {
    // Nothing to do if no bbox in record
    if (!this.bbox) return null;

    // Try to parse bbox in ENVELOPE syntax
    const coords = this.bbox.match(ENVELOPE_REGEX);
    if (!coords) return null;
    if (coords.length !== 5) return null;

    // Convert to numbers and create LngLatBounds
    const west = parseFloat(coords.groups.west);
    const east = parseFloat(coords.groups.east);
    const north = parseFloat(coords.groups.north);
    const south = parseFloat(coords.groups.south);
    return new LngLatBounds([west, south, east, north]);
  }
}
