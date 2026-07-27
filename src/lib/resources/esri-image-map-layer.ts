import EsriResource from './esri';
import { fetchEsriJson, hasCapability } from '../esri';
import { pixelWindowCenter, type PixelWindow } from '../geometry';

// What an ImageServer answers an identify request with: the value of the single pixel under the
// point, rather than a list of features, since there are no features in a raster to return.
type EsriPixelIdentifyResult = {
  name?: string;
  value?: string | number | null;
  properties?: Record<string, unknown> | null;
};

// A value the service uses to mean the point falls outside anything it has coverage for
const NO_DATA = 'NoData';

// An ImageServer, which serves imagery or a raster of measurements - aerial photography, a
// digital elevation model, a satellite mosaic - rendered on demand at the extent we ask for.
export default class EsriImageMapLayerResource extends EsriResource {
  label() {
    return 'ArcGIS Image Map Layer';
  }

  // An ImageServer renders through /exportImage rather than the MapServer's /export, and has no
  // sublayers to choose between
  getMapLibreSourceUrl() {
    return this.exportUrl('exportImage');
  }

  // Any ImageServer that can draw an image can also report the pixel under a click
  async canInspect() {
    return hasCapability(await this.getMetadata(), 'Image');
  }

  // Report the pixel under the middle of the window as a single point feature, so the popup and
  // the selection outline can treat it like the features every other kind of preview returns.
  async inspect(window: PixelWindow): Promise<GeoJSON.Feature[]> {
    const { x, y } = pixelWindowCenter(window);

    const result = await fetchEsriJson<EsriPixelIdentifyResult>(`${this.serviceUrl}/identify`, {
      geometry: JSON.stringify({ x, y, spatialReference: { wkid: 3857 } }),
      geometryType: 'esriGeometryPoint',

      // The geometry would just be the point we asked about, and listing every source image that
      // went into the mosaic is a slow question to ask for a popup
      returnGeometry: 'false',
      returnCatalogItems: 'false',
      f: 'json',
    });

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
