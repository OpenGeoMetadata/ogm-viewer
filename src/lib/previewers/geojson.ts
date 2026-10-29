import type { CircleLayerSpecification, ExpressionSpecification, GeoJSONSourceSpecification, MapGeoJSONFeature, SymbolLayerSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import { IS_LABEL_POINT, unmarkLabelPoints, withLabelPoints } from '../labels';
import type GeoJsonResource from '../resources/geojson';

export type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

const LAST_FIRST: ExpressionSpecification = ['-', 0, ['id']];

export default class GeoJsonPreviewer extends VectorPreviewer {
  declare protected resource: GeoJsonResource;

  protected getSourceId(): string {
    return `${this.resource.id}-geojson`;
  }

  // Favor labels from later features to match the source paint order and popup selection order.
  protected labelPriority() {
    return { 'symbol-sort-key': LAST_FIRST };
  }

  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: await this.resource.getMapLibreSourceType(),
        data: withLabelPoints(await this.resource.getData()),
      },
    ];
  }

  async expandFeatures(features: MapGeoJSONFeature[]): Promise<MapGeoJSONFeature[]> {
    return unmarkLabelPoints(features);
  }

  protected createPolygonLabelLayer(layerId: string): SymbolLayerSpecification {
    return { ...super.createPolygonLabelLayer(layerId), filter: IS_LABEL_POINT };
  }

  protected createPointLayer(layerId: string): CircleLayerSpecification {
    const layer = super.createPointLayer(layerId);
    return { ...layer, filter: ['all', layer.filter as ExpressionSpecification, ['!', IS_LABEL_POINT]] };
  }

  protected createPointLabelLayer(layerId: string): SymbolLayerSpecification {
    const layer = super.createPointLabelLayer(layerId);
    return { ...layer, filter: ['all', layer.filter as ExpressionSpecification, ['!', IS_LABEL_POINT]] };
  }
}
