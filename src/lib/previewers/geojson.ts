import type { GeoJSONSourceSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import type GeoJsonResource from '../resources/geojson';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddGeoJsonSourceObject = GeoJSONSourceSpecification & { id: string };

export default class GeoJsonPreviewer extends VectorPreviewer {
  declare protected resource: GeoJsonResource;

  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: `${this.resource.id}-geojson`,
        type: await this.resource.getMapLibreSourceType(),
        data: await this.resource.getMapLibreSourceUrl(),
        generateId: true, // autogenerate feature IDs for labeling
      },
    ];
  }
}
