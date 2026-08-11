import type { FillLayerSpecification, GeoJSONSourceSpecification, LayerSpecification, LineLayerSpecification } from 'maplibre-gl';

import MapPreviewer from './map';
import type { PreviewStyleLayer } from '../layers';
import type LocationResource from '../resources/location';

// MapLibre doesn't bundle the id with the source, but we need to
type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

// How much of the layer's opacity the fill gets. The outline is what says where the record is; the
// fill is there so a small extent is still findable on a busy basemap, and at full strength it would
// read as data drawn over the map rather than a note about it.
const FILL_OPACITY = 0.2;

/**
 * A record's extent, drawn as a frame rather than as data. What goes on the map when the data itself
 * can't: see LocationResource.
 *
 * Deliberately the plainest previewer here. It has one shape, no features worth naming, and no
 * server behind it, so there is nothing to inspect, nothing to fail, and no reason to hold the map
 * flat - a location reads on a globe as well as anywhere.
 */
export default class LocationPreviewer extends MapPreviewer {
  declare protected resource: LocationResource;

  // There is one shape here and it carries no properties, so a click has nothing to ask about. Left
  // to itself, <ogm-map> would open an attributes popup on an empty table - which is what happens if
  // a caller draws an extent through GeoJsonPreviewer instead of this.
  readonly inspectable = false;

  protected getSourceId(): string {
    return `${this.resource.id}-location`;
  }

  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: this.resource.getGeometry() },
      },
    ];
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layers = [this.createFillLayer(), this.createOutlineLayer()];

    // One row in the layer panel, not two: an outline and the wash inside it are how an extent is
    // drawn, not two things a reader chose to put on the map. Listed at all so it can be turned off
    // - it may be the only thing up, but it is also the only thing in the way of the basemap.
    this.previewLayers.push({
      id: this.getSourceId(),
      title: this.resource.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: layers.map(layer => ({ id: layer.id, type: layer.type }) as PreviewStyleLayer),
    });

    return layers;
  }

  // Hold the fill below the outline at every setting, rather than only at the default. A reader
  // dragging the opacity slider is asking to see more of the basemap, which is the fill's business
  // and not the outline's.
  protected applyOpacity(styleLayer: PreviewStyleLayer, opacity: number) {
    super.applyOpacity(styleLayer, styleLayer.type === 'fill' ? opacity * FILL_OPACITY : opacity);
  }

  private createFillLayer(): FillLayerSpecification {
    return {
      id: `${this.getSourceId()}-fill`,
      type: 'fill' as const,
      source: this.getSourceId(),
      layout: { visibility: 'visible' as const },
      paint: {
        'fill-color': this.style.fillColor,
        'fill-opacity': this.style.opacity * FILL_OPACITY,
      },
    };
  }

  private createOutlineLayer(): LineLayerSpecification {
    return {
      id: `${this.getSourceId()}-outline`,
      type: 'line' as const,
      source: this.getSourceId(),
      layout: { visibility: 'visible' as const },
      paint: {
        'line-color': this.style.strokeColor,
        'line-width': 2,
        'line-opacity': this.style.opacity,
      },
    };
  }
}
