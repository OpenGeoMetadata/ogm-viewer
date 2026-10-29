import { WebMercatorViewport, type LayerContext, type Viewport } from '@deck.gl/core';
import type { _Tile2DHeader as Tile2DHeader } from '@deck.gl/geo-layers';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import type { MinimalTileData, RenderTileResult } from '@developmentseed/deck.gl-raster';

export type Cutline = [west: number, south: number, east: number, north: number];

export type CutlineUniforms = { originHigh: [number, number]; originLow: [number, number]; size: [number, number] };

// Infer COGLayer's unexported tile type from its generic parameter.
type DefaultData = COGLayer extends COGLayer<infer DataT> ? DataT : never;

const MODULE_NAME = 'ogmCutline';

const UNIFORMS = /* glsl */ `\
layout(std140) uniform ${MODULE_NAME}Uniforms {
  vec2 originHigh;
  vec2 originLow;
  vec2 size;
} ${MODULE_NAME};
`;

// Subtract split high/low coordinates near the cutline origin to avoid float32 seams.
export const PreciseCutline = {
  name: MODULE_NAME,
  vs: UNIFORMS,
  fs: UNIFORMS,
  inject: {
    'vs:#decl': `out vec2 v_${MODULE_NAME};`,
    'vs:#main-start': /* glsl */ `
      v_${MODULE_NAME} = (positions.xy - ${MODULE_NAME}.originHigh) + (positions64Low.xy - ${MODULE_NAME}.originLow);
    `,
    'fs:#decl': `in vec2 v_${MODULE_NAME};`,
    // The varying is only in scope at main-start, outside the generated color filter function.
    'fs:#main-start': /* glsl */ `
      if (any(lessThan(v_${MODULE_NAME}, vec2(0.0))) || any(greaterThan(v_${MODULE_NAME}, ${MODULE_NAME}.size))) {
        discard;
      }
    `,
  },
  uniformTypes: {
    originHigh: 'vec2<f32>',
    originLow: 'vec2<f32>',
    size: 'vec2<f32>',
  },
  getUniforms: (props: Partial<CutlineUniforms>) => props,
} as const;

// Overlap neighboring sheets slightly to cover residual projection error at high zoom.
const CUTLINE_TOLERANCE = { flat: 5e-6, globe: 5e-6 };

const COMMON_SPACE = new WebMercatorViewport({ width: 1, height: 1 });

const split = (value: number): [high: number, low: number] => {
  const high = Math.fround(value);
  return [high, value - high];
};

const toUniforms = ([minX, minY, maxX, maxY]: Cutline, tolerance: number): CutlineUniforms => {
  const [highX, lowX] = split(minX - tolerance);
  const [highY, lowY] = split(minY - tolerance);
  return { originHigh: [highX, highY], originLow: [lowX, lowY], size: [maxX - minX + 2 * tolerance, maxY - minY + 2 * tolerance] };
};

const globeUniforms = new WeakMap<Cutline, CutlineUniforms>();
const flatUniforms = new WeakMap<Cutline, CutlineUniforms>();

export const cutlineUniforms = (cutline: Cutline, globe: boolean): CutlineUniforms => {
  const cache = globe ? globeUniforms : flatUniforms;
  let uniforms = cache.get(cutline);
  if (!uniforms) {
    const [west, south, east, north] = cutline;
    const [minX, minY] = globe ? [west, south] : COMMON_SPACE.projectPosition([west, south]);
    const [maxX, maxY] = globe ? [east, north] : COMMON_SPACE.projectPosition([east, north]);
    uniforms = toUniforms([minX, minY, maxX, maxY], globe ? CUTLINE_TOLERANCE.globe : CUTLINE_TOLERANCE.flat);
    cache.set(cutline, uniforms);
  }
  return uniforms;
};

const isGlobe = (viewport: Viewport) => (viewport as { resolution?: number }).resolution !== undefined;

// Choose cutline units per tile: deck.gl switches a globe to Mercator at high zoom.
export default class ClippedCOGLayer<DataT extends MinimalTileData = DefaultData> extends COGLayer<DataT> {
  static layerName = 'ClippedCOGLayer';

  protected _renderTileCallback(): ((data: DataT) => RenderTileResult | null) | undefined {
    const renderTile = super._renderTileCallback();
    const { cutline } = this.props as { cutline?: Cutline };
    if (!renderTile || !cutline) return renderTile;

    return data => {
      const result = renderTile(data);
      const props = cutlineUniforms(cutline, isGlobe(this.context.viewport));
      return result && { ...result, renderPipeline: [...(result.renderPipeline ?? []), { module: PreciseCutline, props }] };
    };
  }

  // Unload cached tiles explicitly; TileLayer finalization does not release their GPU textures.
  finalizeState(context: LayerContext) {
    this.releaseLoadedTiles();
    super.finalizeState(context);
  }

  protected releaseLoadedTiles() {
    const unload = this._onTileUnloadCallback();
    if (!unload) return;

    for (const sublayer of this.getSubLayers()) {
      const { tileset } = (sublayer.state ?? {}) as { tileset?: { tiles: Tile2DHeader<DataT>[] } };
      for (const tile of tileset?.tiles ?? []) {
        if (tile.content) unload(tile);
      }
    }
  }
}
