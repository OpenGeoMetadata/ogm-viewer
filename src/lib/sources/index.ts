import { OgmRecord } from '../record';
import Source from './source';
import GeoJSONSource from './geojson';
import OpenIndexMapSource from './openindexmap';
import WMSSource from './wms';
import TMSSource from './tms';
import XYZSource from './xyz';
import PMTilesSource from './pmtiles';
import TileJSONSource from './tilejson';
import CogSource from './cog';

// Given a record, get all of the valid sources that can be used to preview it on a map
export const getSources = (record: OgmRecord): Source[] => {
  const sources = [] as Source[];
  if (record.references.pmtilesUrl) sources.push(new PMTilesSource(record.id, record.references.pmtilesUrl));
  if (record.references.tilejsonUrl) sources.push(new TileJSONSource(record.id, record.references.tilejsonUrl));
  if (record.references.indexMapUrl) sources.push(new OpenIndexMapSource(record.id, record.references.indexMapUrl));
  if (record.references.geojsonUrl) sources.push(new GeoJSONSource(record.id, record.references.geojsonUrl));
  if (record.references.cogUrl) sources.push(new CogSource(record.id, record.references.cogUrl));
  if (record.references.tmsUrl) sources.push(new TMSSource(record.id, record.references.tmsUrl));
  if (record.references.xyzUrl) sources.push(new XYZSource(record.id, record.references.xyzUrl));
  if (record.references.wmsUrl && record.wxsIdentifier) sources.push(new WMSSource(record.id, record.references.wmsUrl, { layerIds: [record.wxsIdentifier] }));
  return sources;
};
