import EsriResource from './esri';
import { esriIdentifyResultsToFeatures, fetchEsriJson, hasCapability, type EsriIdentifyResult } from '../esri';
import { pixelWindowCenter, type PixelWindow } from '../geometry';

const IDENTIFY_TOLERANCE = 3;

export default abstract class EsriMapServerResource extends EsriResource {
  async canInspect() {
    return hasCapability(await this.getMetadata(), 'Query');
  }

  async inspect(window: PixelWindow): Promise<GeoJSON.Feature[]> {
    const response = await fetchEsriJson<{ results?: EsriIdentifyResult[] }>(`${this.serviceUrl}/identify`, this.identifyParams(window), this.requestTransform);
    return esriIdentifyResultsToFeatures(response.results);
  }

  protected identifyParams(window: PixelWindow): Record<string, string> {
    const { x, y, resolution } = pixelWindowCenter(window);

    return {
      geometry: JSON.stringify({ x, y, spatialReference: { wkid: 3857 } }),
      geometryType: 'esriGeometryPoint',
      sr: '3857',

      layers: `all${this.layerId ? `:${this.layerId}` : ''}`,
      tolerance: String(IDENTIFY_TOLERANCE),
      mapExtent: window.bbox,
      imageDisplay: `${window.width},${window.height},96`,
      returnGeometry: 'true',

      maxAllowableOffset: String(resolution),
      f: 'json',
    };
  }
}
