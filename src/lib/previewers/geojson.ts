import type { CircleLayerSpecification, ExpressionSpecification, GeoJSONSourceSpecification, MapGeoJSONFeature, SymbolLayerSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import { IS_LABEL_POINT, unmarkLabelPoints, withLabelPoints } from '../labels';
import type GeoJsonResource from '../resources/geojson';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

// A feature's position in its document, negated, so the last of a stack sorts first
const LAST_FIRST: ExpressionSpecification = ['-', 0, ['id']];

export default class GeoJsonPreviewer extends VectorPreviewer {
  declare protected resource: GeoJsonResource;

  // A record can reference the same data more than one way, so keep the sources distinct. The
  // style layers draw from this too, so both have to come from here.
  protected getSourceId(): string {
    return `${this.resource.id}-geojson`;
  }

  // A document is drawn in the order it lists its features, so the last of a stack is the one on top
  // and the one a click lists first. Its ids are numbered from that same position - see
  // withLabelPoints - which makes the id a key that gives the stack's label to the feature on top. An
  // index map that lists a sheet's editions oldest first is labelled with the latest.
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

  // A label hit on its own, outside the polygon it names, answers with the polygon's properties
  async expandFeatures(features: MapGeoJSONFeature[]): Promise<MapGeoJSONFeature[]> {
    return unmarkLabelPoints(features);
  }

  // Polygon labels are drawn at the label points rather than over the polygons themselves
  protected createPolygonLabelLayer(layerId: string): SymbolLayerSpecification {
    return { ...super.createPolygonLabelLayer(layerId), filter: IS_LABEL_POINT };
  }

  // The label points are points, but not ones the document drew
  protected createPointLayer(layerId: string): CircleLayerSpecification {
    const layer = super.createPointLayer(layerId);
    return { ...layer, filter: ['all', layer.filter as ExpressionSpecification, ['!', IS_LABEL_POINT]] };
  }

  protected createPointLabelLayer(layerId: string): SymbolLayerSpecification {
    const layer = super.createPointLabelLayer(layerId);
    return { ...layer, filter: ['all', layer.filter as ExpressionSpecification, ['!', IS_LABEL_POINT]] };
  }
}
