import GeoJsonPreviewer from './geojson';
import type { AddGeoJsonSourceObject } from './geojson';
import type EsriFeatureLayerResource from '../resources/esri-feature-layer';

export default class EsriFeatureLayerPreviewer extends GeoJsonPreviewer {
  declare protected resource: EsriFeatureLayerResource;

  // A record can point at the same ArcGIS service more than one way, so keep the sources distinct
  protected getSourceId(): string {
    return `${this.resource.id}-esri-feature-layer`;
  }

  // The features have to be read out of the service a page at a time, and may need converting from
  // Esri JSON first, so MapLibre gets the assembled collection rather than a URL to fetch itself
  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'geojson',
        data: await this.resource.getData(),
        generateId: true, // autogenerate feature IDs for labeling
      },
    ];
  }
}
