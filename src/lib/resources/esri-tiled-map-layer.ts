import EsriMapServerResource from './esri-map-server';
import type { ResourceKind } from './resource';
import { esriExtentToSourceBounds, hasCapability, isWebMercator, type EsriTileInfo } from '../esri';
import type { EsriRasterSourceSpec } from './esri';

const MERCATOR_EXTENT = 20037508.342789244;

const RESOLUTION_TOLERANCE = 0.001;
const ORIGIN_TOLERANCE = 1;

export default class EsriTiledMapLayerResource extends EsriMapServerResource {
  readonly kind: ResourceKind = 'esri-tiled-map-layer';

  label() {
    return 'ArcGIS Tiled Map Layer';
  }

  // Use cached XYZ tiles only for compatible grids; otherwise ask the service to reproject them.
  async getRasterSourceSpec(): Promise<EsriRasterSourceSpec> {
    const tileInfo = await this.getXyzTileInfo();
    if (!tileInfo) return await this.getExportSourceSpec();

    const metadata = await this.getMetadata();
    const levels = (tileInfo.lods ?? []).map(lod => lod.level);

    const bounds = esriExtentToSourceBounds(metadata.fullExtent ?? metadata.extent);

    return {
      tiles: [`${this.serviceUrl}/tile/{z}/{y}/{x}`],
      scheme: 'xyz',
      tileSize: tileInfo.cols ?? this.getTileSize(),
      minzoom: Math.min(...levels),
      maxzoom: Math.max(...levels),
      ...(bounds && { bounds }),
    };
  }

  private async getExportSourceSpec(): Promise<EsriRasterSourceSpec> {
    const metadata = await this.getMetadata();
    if (hasCapability(metadata, 'TilesOnly')) {
      throw new Error("This layer's tiles aren't cut on the Web Mercator grid, and the service can only serve them as they are, so they can't be drawn on the map.");
    }

    return { tiles: [this.exportUrl('export')], tileSize: this.getTileSize() };
  }

  private async getXyzTileInfo(): Promise<EsriTileInfo | undefined> {
    const { singleFusedMapCache, tileInfo } = await this.getMetadata();
    if (!singleFusedMapCache || !tileInfo?.lods?.length || !tileInfo.cols) return undefined;
    if (!isWebMercator(tileInfo.spatialReference)) return undefined;

    const { origin } = tileInfo;
    if (!origin) return undefined;
    if (Math.abs(origin.x + MERCATOR_EXTENT) > ORIGIN_TOLERANCE) return undefined;
    if (Math.abs(origin.y - MERCATOR_EXTENT) > ORIGIN_TOLERANCE) return undefined;

    const matchesPyramid = tileInfo.lods.every(lod => {
      const expected = (2 * MERCATOR_EXTENT) / (tileInfo.cols as number) / 2 ** lod.level;
      return Math.abs(lod.resolution - expected) / expected < RESOLUTION_TOLERANCE;
    });

    return matchesPyramid ? tileInfo : undefined;
  }
}
