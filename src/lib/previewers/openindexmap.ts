import type { LayerSpecification } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import { previewStyleLayers } from './vector';
import type { Layer } from '../layers';
import type { LegendEntry } from '../legend';

const LABELS_SUFFIX = '-labels';

export default class OpenIndexMapPreviewer extends GeoJsonPreviewer {
  // Starts fainter than a regular vector would; we don't care as much about
  // the geometry because it's just showing where the sheets are.
  protected getDefaultOpacity(): number {
    return this.style.boundsOpacity;
  }

  // The labels are the exception; they need to be readable, so they use the
  // default theme opacity instead of the more transparent one.
  protected getLabelOpacity(): number {
    return this.style.opacity;
  }

  // Title for the layer group actually controls the polygons, in the layers
  // browser.
  protected previewLayerTitle(_layerId: string): string {
    return 'Geometry';
  }

  // Split the geometry and labels into separate layer groups that can be
  // toggled/faded separately. This allows hiding the labels when they're too
  // dense and crowding the preview.
  protected createPreviewLayers(layerId: string, geometry: LayerSpecification[], labels: LayerSpecification[]): Layer[] {
    return [
      // The ordinary row, minus the labels that have been taken out of it
      ...super.createPreviewLayers(layerId, geometry, []),
      {
        id: `${this.previewLayerId(layerId)}${LABELS_SUFFIX}`,
        title: 'Sheet labels',
        defaultOpacity: this.getLabelOpacity(),
        styleLayers: previewStyleLayers(labels),
      },
    ];
  }

  // Legend that shows what the colors mean.
  get legendEntries(): LegendEntry[] {
    if (!this.attached || !this.boundariesDrawn) return [];

    return [
      { label: 'Available map', color: this.style.dataColor },
      { label: 'Unavailable map', color: this.style.invalidColor },
      { label: 'Selected map', color: this.style.selectedColor },
    ];
  }

  // Used to hide the legend if the geometry isn't being shown, since it would
  // be meaningless if it doesn't correspond to anything on the map.
  private get boundariesDrawn(): boolean {
    return this.previewLayers.some(layer => !layer.id.endsWith(LABELS_SUFFIX) && this.layerDrawn(layer.id));
  }
}
