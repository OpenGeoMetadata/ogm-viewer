import GeoJSONSource from '../sources/geojson';
import OpenIndexMapSource from '../sources/openindexmap';
import PMTilesSource from '../sources/pmtiles';
import Source from '../sources/source';
import WmsSource from '../sources/wms';

import RasterSource from '../sources/raster';
import GeoJSONPreviewer from './geojson';
import MapLibrePreviewer from './maplibre';
import OpenIndexMapPreviewer from './openindexmap';
import PMTilesRasterPreviewer from './pmtiles-raster';
import PMTilesVectorPreviewer from './pmtiles-vector';
import RasterPreviewer from './raster';
import WmsPreviewer from './wms';

// Given a list of sources, return a list of previewers that can be used to preview them on a map
export const getMapPreviewers = async (sources: Source[], map: maplibregl.Map, options: any) => {
  const previewers = [] as MapLibrePreviewer[];

  for (const source of sources) {
    if (source instanceof OpenIndexMapSource) previewers.push(new OpenIndexMapPreviewer(source, map, options));
    else if (source instanceof GeoJSONSource) previewers.push(new GeoJSONPreviewer(source, map, options));
    else if (source instanceof PMTilesSource) {
      if (await source.isVector()) previewers.push(new PMTilesVectorPreviewer(source, map, options));
      else previewers.push(new PMTilesRasterPreviewer(source, map, options));
    } else if (source instanceof WmsSource) previewers.push(new WmsPreviewer(source, map, options));
    else if (source instanceof RasterSource) previewers.push(new RasterPreviewer(source, map, options));
  }

  return previewers;
};
