import type { FillLayerSpecification, GeoJSONSourceSpecification, LayerSpecification, LineLayerSpecification } from 'maplibre-gl';

import MapPreviewer from './map';
import type { PreviewStyleLayer } from '../layers';
import LocationResource from '../resources/location';
import type OgmRecord from '../record';

type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

export const FILL_OPACITY = 0.2;

export default class LocationPreviewer extends MapPreviewer {
  declare protected resource: LocationResource;

  // Extent geometry has no attributes to inspect, so do not offer an empty popup.
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

    this.previewLayers.push({
      id: this.getSourceId(),
      title: this.resource.label(),
      defaultOpacity: this.style.boundsOpacity,
      styleLayers: layers.map(layer => ({ id: layer.id, type: layer.type }) as PreviewStyleLayer),
    });

    return layers;
  }

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
        'fill-color': this.style.dataColor,
        'fill-opacity': this.style.boundsOpacity * FILL_OPACITY,
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
        'line-opacity': this.style.boundsOpacity,
      },
    };
  }
}

export const locationFor = (record: OgmRecord): LocationPreviewer | undefined => {
  const geometry = record.getGeometry();
  return geometry ? new LocationPreviewer(new LocationResource(record.id, geometry as GeoJSON.Geometry)) : undefined;
};

export const locationsFor = (records: OgmRecord[]): (LocationPreviewer | undefined)[] => records.map(locationFor);
