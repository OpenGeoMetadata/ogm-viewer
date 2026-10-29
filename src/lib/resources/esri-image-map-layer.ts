import EsriResource from './esri';
import type { ResourceKind } from './resource';
import { fetchEsriJson, hasCapability } from '../esri';
import { pixelWindowCenter, type PixelWindow } from '../geometry';

type EsriPixelIdentifyResult = {
  name?: string;
  value?: string | number | null;
  properties?: Record<string, unknown> | null;
};

const NO_DATA = 'NoData';

export default class EsriImageMapLayerResource extends EsriResource {
  readonly kind: ResourceKind = 'esri-image-map-layer';

  label() {
    return 'ArcGIS Image Map Layer';
  }

  getMapLibreSourceUrl() {
    return this.exportUrl('exportImage');
  }

  async canInspect() {
    return hasCapability(await this.getMetadata(), 'Image');
  }

  async inspect(window: PixelWindow): Promise<GeoJSON.Feature[]> {
    const { x, y } = pixelWindowCenter(window);

    const result = await fetchEsriJson<EsriPixelIdentifyResult>(
      `${this.serviceUrl}/identify`,
      {
        geometry: JSON.stringify({ x, y, spatialReference: { wkid: 3857 } }),
        geometryType: 'esriGeometryPoint',

        returnGeometry: 'false',
        returnCatalogItems: 'false',
        f: 'json',
      },
      this.requestTransform,
    );

    const { value } = result;
    if (value === undefined || value === null || value === '' || value === NO_DATA) return [];

    return [
      {
        type: 'Feature',
        id: 0,
        geometry: { type: 'Point', coordinates: [x, y] },
        properties: { [result.name || 'Value']: value, ...(result.properties ?? {}) },
      },
    ];
  }
}
