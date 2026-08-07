import maplibregl from 'maplibre-gl';
import { cogProtocol, setRequestHeaders } from '@geomatico/maplibre-cog-protocol';

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

  // COG sources use 'url' instead of 'tiles' and have no scheme. @geomatico/maplibre-cog-protocol
  // offers no per-URL auth hook, only a single header set shared by every COG on the page (see
  // setRequestHeaders) - so a page previewing two authenticated COGs at once can't have both
  // right at the same time. Re-assert ours immediately before the source that will trigger this
  // one's tile requests goes on the map, to keep that window as small as it can be.
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    setRequestHeaders(this.requestTransform?.(this.resource.url, 'tile')?.headers ?? {});

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
