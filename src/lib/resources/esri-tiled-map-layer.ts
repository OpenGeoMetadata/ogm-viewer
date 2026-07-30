import EsriMapServerResource from './esri-map-server';
import type { ResourceKind } from './resource';
import { esriExtentToSourceBounds, hasCapability, isWebMercator, type EsriTileInfo } from '../esri';
import type { EsriRasterSourceSpec } from './esri';

// Half the width of the Web Mercator plane in meters: the northwest corner every standard tile
// pyramid hangs from, and the number the resolution of each of its zooms divides down from.
const MERCATOR_EXTENT = 20037508.342789244;

// Cached zooms and tile origins are floating point numbers in the service description, so the
// comparisons against the standard pyramid have to leave room for rounding. A zoom whose scale is
// off by a tenth of a percent is the standard one; a grid on a different origin is meters away.
const RESOLUTION_TOLERANCE = 0.001;
const ORIGIN_TOLERANCE = 1;

// A MapServer whose map has been rendered into a cache of tiles ahead of time, so a preview reads
// finished images instead of waiting for the server to draw them.
export default class EsriTiledMapLayerResource extends EsriMapServerResource {
  readonly kind: ResourceKind = 'esri-tiled-map-layer';

  label() {
    return 'ArcGIS Tiled Map Layer';
  }

  // A cache cut on the same grid MapLibre draws in can be read straight as XYZ tiles. One cut on
  // another grid can't, so fall back to having the service draw the map on demand - which is how
  // ArcGIS's own clients handle a cache they can't line up with the map they're drawing.
  async getRasterSourceSpec(): Promise<EsriRasterSourceSpec> {
    const tileInfo = await this.getXyzTileInfo();
    if (!tileInfo) return await this.getExportSourceSpec();

    const metadata = await this.getMetadata();
    const levels = (tileInfo.lods ?? []).map(lod => lod.level);

    // Keeps MapLibre from asking for tiles the cache was never cut for. Left out rather than passed
    // as undefined, which MapLibre validates as a malformed source.
    const bounds = esriExtentToSourceBounds(metadata.fullExtent ?? metadata.extent);

    return {
      // ArcGIS orders the path zoom/row/column, which is y before x
      tiles: [`${this.serviceUrl}/tile/{z}/{y}/{x}`],
      scheme: 'xyz',
      tileSize: tileInfo.cols ?? this.getTileSize(),
      minzoom: Math.min(...levels),
      maxzoom: Math.max(...levels),
      ...(bounds && { bounds }),
    };
  }

  // Redrawing the map on demand is only possible when the service does more than serve its cache
  private async getExportSourceSpec(): Promise<EsriRasterSourceSpec> {
    const metadata = await this.getMetadata();
    if (hasCapability(metadata, 'TilesOnly')) {
      throw new Error("This layer's tiles aren't cut on the Web Mercator grid, and the service can only serve them as they are, so they can't be drawn on the map.");
    }

    return { tiles: [this.exportUrl('export')], tileSize: this.getTileSize() };
  }

  // The cache's tiling, if it matches the pyramid MapLibre expects: square tiles in Web Mercator,
  // hung from the northwest corner of the world, with each zoom halving the one above it. Anything
  // else - a state plane cache, a custom set of scales - can't be addressed by z/x/y at all.
  private async getXyzTileInfo(): Promise<EsriTileInfo | undefined> {
    const { singleFusedMapCache, tileInfo } = await this.getMetadata();
    if (!singleFusedMapCache || !tileInfo?.lods?.length || !tileInfo.cols) return undefined;
    if (!isWebMercator(tileInfo.spatialReference)) return undefined;

    const { origin } = tileInfo;
    if (!origin) return undefined;
    if (Math.abs(origin.x + MERCATOR_EXTENT) > ORIGIN_TOLERANCE) return undefined;
    if (Math.abs(origin.y - MERCATOR_EXTENT) > ORIGIN_TOLERANCE) return undefined;

    // At each zoom the world is 2^level tiles across, so a tile spans this many meters per pixel
    const matchesPyramid = tileInfo.lods.every(lod => {
      const expected = (2 * MERCATOR_EXTENT) / (tileInfo.cols as number) / 2 ** lod.level;
      return Math.abs(lod.resolution - expected) / expected < RESOLUTION_TOLERANCE;
    });

    return matchesPyramid ? tileInfo : undefined;
  }
}
