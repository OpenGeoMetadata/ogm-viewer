import type { ExpressionSpecification, GeoJSONSourceSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
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
  // and the one a click lists first. Its ids are generated from that same position - see
  // createSources - which makes the id a key that gives the stack's label to the feature on top. An
  // index map that lists a sheet's editions oldest first is labelled with the latest.
  protected labelPriority() {
    return { 'symbol-sort-key': LAST_FIRST };
  }

  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: await this.resource.getMapLibreSourceType(),
        data: await this.resource.getMapLibreSourceUrl(),
        generateId: true, // autogenerate feature IDs for labeling
      },
    ];
  }
}
