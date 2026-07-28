import RasterPreviewer from './raster';
import type WmtsResource from '../resources/wmts';
import type { WmtsLayer } from '../resources/wmts';
import type { AddRasterSourceObject } from './raster';
import type { RasterLayerSpecification } from 'maplibre-gl';

export default class WmtsPreviewer extends RasterPreviewer {
  declare protected resource: WmtsResource;
  protected layers: WmtsLayer[];

  // WMTS sources have multiple XYZ tile URLs for fallbacks, and each layer
  // can have different tile size, zoom range, bounds, etc.
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    const layers = await this.resource.getLayers();

    return layers.map(layer => ({
      id: `${this.resource.id}-${layer.id}`,
      type: 'raster',
      tiles: layer.tileUrls,
      scheme: this.resource.getScheme(),
      tileSize: layer.tileSize,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      ...(layer.bounds && { bounds: layer.bounds }),
    }));
  }

  // One layer per source, with the same ID as the source. Each is its own row in the layer
  // control, titled from the <ows:Title> the service published for people to read rather than the
  // identifier it uses to address the layer.
  protected async createLayers(): Promise<RasterLayerSpecification[]> {
    const layers = await this.resource.getLayers();

    return layers.map(layer => {
      const id = `${this.resource.id}-${layer.id}`;

      this.previewLayers.push({
        id,
        title: layer.title?.trim() || layer.id,
        defaultOpacity: this.style.opacity,
        styleLayers: [{ id, type: 'raster' }],
      });

      return {
        id,
        type: 'raster' as const,
        source: id,
        layout: {
          visibility: 'visible' as const,
        },
        paint: {
          'raster-opacity': this.style.opacity,
        },
      };
    });
  }
}
