import type { GeoJSONSourceSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import type GeoJsonResource from '../resources/geojson';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

export default class GeoJsonPreviewer extends VectorPreviewer {
  declare protected resource: GeoJsonResource;

  // A record can reference the same data more than one way, so keep the sources distinct. The
  // style layers draw from this too, so both have to come from here.
  protected getSourceId(): string {
    return `${this.resource.id}-geojson`;
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
