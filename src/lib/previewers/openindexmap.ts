import GeoJsonPreviewer from './geojson';

export default class OpenIndexMapPreviewer extends GeoJsonPreviewer {
  // Starts fainter than a GeoJSON document would. An index map's polygons are sheet boundaries -
  // where to find the scans, not something anyone came to read - so they have less claim on the
  // basemap than data does, and they tile the whole extent, so at full strength there is no basemap
  // left to place them against. The same reasoning a bounding box gets, and the same theme value.
  protected getDefaultOpacity(): number {
    return this.style.boundsOpacity;
  }
}
