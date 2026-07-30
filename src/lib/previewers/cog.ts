import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import RasterPreviewer from './raster';
import type CogResource from '../resources/cog';
import type Resource from '../resources/resource';
import { type AddRasterSourceObject } from './raster';

// COG previewer using MapLibre COG protocol plugin
// Only works for COGs in Web Mercator projection; can't warp in-browser
// See: https://github.com/geomatico/maplibre-cog-protocol
export default class CogPreviewer extends RasterPreviewer {
  declare protected resource: CogResource;

  // Register the 'cog://' protocol handler with MapLibre when the previewer is created. Takes a
  // Resource like every other previewer - the narrowing that matters is on the field above.
  constructor(resource: Resource) {
    super(resource);
    maplibregl.addProtocol('cog', cogProtocol);
  }

  // A COG has no scheme to name it by, and the raster layer draws from this too
  protected getSourceId(): string {
    return `${this.resource.id}-cog`;
  }

  // COG sources use 'url' instead of 'tiles' and have no scheme
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
        tileSize: this.resource.getTileSize(),
      },
    ];
  }
}
