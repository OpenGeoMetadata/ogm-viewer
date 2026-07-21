import maplibregl, { RasterSourceSpecification } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import RasterPreviewer from './raster';
import CogResource from '../resources/cog';
import { type MapLibreStyle } from '../themes/maplibre';

// COG previewer using MapLibre COG protocol plugin
// Only works for COGs in Web Mercator projection; can't warp in-browser
// See: https://github.com/geomatico/maplibre-cog-protocol
export default class CogPreviewer extends RasterPreviewer {
  declare protected resource: CogResource;

  // Register the 'cog://' protocol handler with MapLibre when the previewer is created
  constructor(resource: CogResource, map: maplibregl.Map, style: MapLibreStyle) {
    super(resource, map, style);
    maplibregl.addProtocol('cog', cogProtocol);
  }

  // COG sources use 'url' instead of 'tiles' and have no scheme
  protected async createSources(): Promise<RasterSourceSpecification[]> {
    return [
      {
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
        tileSize: this.resource.getTileSize(),
      },
    ];
  }

  protected getSourceId(): string {
    return `${this.resource.id}-cog`;
  }
}
