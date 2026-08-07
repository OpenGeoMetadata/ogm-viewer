import EsriResource from './esri';
import { esriIdentifyResultsToFeatures, fetchEsriJson, hasCapability, type EsriIdentifyResult } from '../esri';
import { pixelWindowCenter, type PixelWindow } from '../geometry';

// How far from the click, in pixels, ArcGIS should look for something to report. Zero would only
// match a click landing exactly on a line or a point, which is close to impossible to do by hand.
const IDENTIFY_TOLERANCE = 3;

// A MapServer, which holds a map document of one or more feature layers and can both draw them and
// say which of their features it drew at a given point. Subclasses decide how the drawing is
// fetched - re-rendered on demand, or read out of a cache of tiles.
export default abstract class EsriMapServerResource extends EsriResource {
  // A MapServer answers identify requests when it publishes the Query capability. One that serves
  // tiles only holds pictures, with no features left to ask about.
  async canInspect() {
    return hasCapability(await this.getMetadata(), 'Query');
  }

  // Ask the service which features it drew at the middle of the window
  async inspect(window: PixelWindow): Promise<GeoJSON.Feature[]> {
    const response = await fetchEsriJson<{ results?: EsriIdentifyResult[] }>(`${this.serviceUrl}/identify`, this.identifyParams(window), this.requestTransform);
    return esriIdentifyResultsToFeatures(response.results);
  }

  // ArcGIS locates a click by coordinate rather than by pixel, but still wants the extent and
  // pixel size of the map it was drawn on, so it can scale the tolerance and skip the layers that
  // aren't drawn at this zoom.
  protected identifyParams(window: PixelWindow): Record<string, string> {
    const { x, y, resolution } = pixelWindowCenter(window);

    return {
      geometry: JSON.stringify({ x, y, spatialReference: { wkid: 3857 } }),
      geometryType: 'esriGeometryPoint',
      sr: '3857',

      // 'all' reaches layers the service doesn't draw by default, which a reference can point at
      layers: `all${this.layerId ? `:${this.layerId}` : ''}`,
      tolerance: String(IDENTIFY_TOLERANCE),
      mapExtent: window.bbox,
      imageDisplay: `${window.width},${window.height},96`,
      returnGeometry: 'true',

      // Outline what was matched at the detail the map can show, rather than sending back every
      // vertex of a coastline to draw a highlight a few pixels wide
      maxAllowableOffset: String(resolution),
      f: 'json',
    };
  }
}
