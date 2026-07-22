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

  // One layer per source, with the same ID as the source
  protected async createLayers(): Promise<RasterLayerSpecification[]> {
    const layers = await this.resource.getLayers();

    return layers.map(layer => ({
      id: `${this.resource.id}-${layer.id}`,
      type: 'raster' as const,
      source: `${this.resource.id}-${layer.id}`,
      paint: {
        'raster-opacity': this.opacity,
      },
    }));
  }
}
