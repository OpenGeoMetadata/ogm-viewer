import type { GeoJSONSourceSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import type GeoJsonResource from '../resources/geojson';

export default class GeoJsonPreviewer extends VectorPreviewer {
  declare protected resource: GeoJsonResource;

  protected async createSources(): Promise<GeoJSONSourceSpecification[]> {
    return [
      {
        type: await this.resource.getMapLibreSourceType(),
        data: await this.resource.getMapLibreSourceUrl(),
        generateId: true, // autogenerate feature IDs for labeling
      },
    ];
  }
}
