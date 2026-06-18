import type { GeoJSONSourceSpecification } from 'maplibre-gl';

import VectorPreviewer from './vector';
import type GeoJSONSource from '../sources/geojson';

export default class GeoJSONPreviewer extends VectorPreviewer {
  declare protected source: GeoJSONSource;

  protected async createSource(): Promise<GeoJSONSourceSpecification> {
    return {
      type: await this.source.getType(),
      data: await this.source.getSourceUrl(),
    };
  }
}
