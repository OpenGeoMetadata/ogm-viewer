import GeoJsonPreviewer from './geojson';
import type { LegendEntry } from '../legend';

export default class OpenIndexMapPreviewer extends GeoJsonPreviewer {
  // Starts fainter than a GeoJSON document would. An index map's polygons are sheet boundaries -
  // where to find the scans, not something anyone came to read - so they have less claim on the
  // basemap than data does, and they tile the whole extent, so at full strength there is no basemap
  // left to place them against. The same reasoning a bounding box gets, and the same theme value.
  protected getDefaultOpacity(): number {
    return this.style.boundsOpacity;
  }

  // OpenIndexMaps gives `available` a meaning the colors alone cannot communicate. These labels
  // follow GeoBlacklight's index-map legend, while the colors come from the exact style currently
  // attached to this preview so an embedding page's --ogm-* overrides are reflected here too.
  // There is nothing to explain after the only layer has been hidden or faded away.
  get legendEntries(): LegendEntry[] {
    if (!this.attached || !this.anyLayerVisible) return [];

    return [
      { label: 'Available map', color: this.style.dataColor },
      { label: 'Unavailable map', color: this.style.invalidColor },
      { label: 'Selected map', color: this.style.selectedColor },
    ];
  }
}
