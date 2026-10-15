import { WebMercatorViewport, type LayerContext, type Viewport } from '@deck.gl/core';
import type { _Tile2DHeader as Tile2DHeader } from '@deck.gl/geo-layers';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import type { MinimalTileData, RenderTileResult } from '@developmentseed/deck.gl-raster';

// The part of a raster worth drawing, in WGS84: [west, south, east, north]
export type Cutline = [west: number, south: number, east: number, north: number];

// A cutline as the shader takes it, in whichever space the mesh is in: its southwest corner, split
// into the float32 nearest it and what that float32 leaves over, and its width and height
export type CutlineUniforms = { originHigh: [number, number]; originLow: [number, number]; size: [number, number] };

// COGLayer's own tile type, which it leaves unexported: what its inferred pipeline hands renderTile
type DefaultData = COGLayer extends COGLayer<infer DataT> ? DataT : never;

const MODULE_NAME = 'ogmCutline';

// Declared on both sides, since the vertex shader measures and the fragment shader decides. std140
// spelled out, as luma.gl's own picking module does, so the layout is the one luma.gl writes.
const UNIFORMS = /* glsl */ `\
layout(std140) uniform ${MODULE_NAME}Uniforms {
  vec2 originHigh;
  vec2 originLow;
  vec2 size;
} ${MODULE_NAME};
`;

/**
 * Discard every fragment outside a box - @developmentseed/deck.gl-raster's CutlineBbox, measured
 * precisely enough to join sheets up.
 *
 * CutlineBbox compares each vertex's float32 position against a float32 box. Common space is 512
 * units across the world, so at Colorado's latitude a float32 there is only good to about 3e-5 of a
 * unit: two pixels at zoom 16, and eight at zoom 18. Two sheets each rounding their shared
 * edge their own way draw a band of both along it, or leave one of neither.
 *
 * So this measures from the box's corner instead, in the two halves deck.gl's own fp64 projection
 * uses: the mesh hands over each position as a float32 and the remainder that float32 couldn't hold
 * (positions64Low; see deck.gl-raster's MeshTextureLayer), and the corner arrives split the same way.
 * Subtracting the high halves is exact for numbers that close together, and adding the remainders
 * back recovers what float32 dropped - leaving a small offset into the box, which a float32 holds to
 * well under a pixel at any zoom.
 *
 * That leaves the box precise, but not the tiles drawn against it: measured on 3DEP's tiles, the
 * same edge still lands a few millionths of a unit apart in two neighbours - a third of what
 * CutlineBbox leaves, but still pixels apart at zoom 18 - which is the error left in deck.gl's own
 * fp64 vertex projection and nothing a cutline can reach. So boxes are let out a little - see
 * CUTLINE_TOLERANCE - and neighbours overlap by a sliver rather than part by one.
 */
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
    // At #main-start rather than DECKGL_FILTER_COLOR, for the reason CutlineBbox gives: the varying
    // isn't in scope inside the generated filter function
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
  // Already split and projected, once per cutline; luma.gl calls this on every draw
  getUniforms: (props: Partial<CutlineUniforms>) => props,
} as const;

// How far past its outline each sheet is drawn, in the units of the space it's clipped in: about 30cm
// on the ground either way. Measured on 3DEP's tiles at zooms 15 to 18.5, with nothing let out two
// neighbours left a gap of up to 3 device pixels between them, and half this closed it with nothing
// to spare - so this is twice that. What they share is then a pixel or two up to zoom 17 and a few at
// 18.5, and only shows at all below full opacity, where a gap shows the basemap through at any.
const CUTLINE_TOLERANCE = { flat: 5e-6, globe: 5e-6 };

// Only for projecting into deck.gl's common space, which doesn't depend on the view - so any instance will do
const COMMON_SPACE = new WebMercatorViewport({ width: 1, height: 1 });

// A number as the float32 nearest it and the rest
const split = (value: number): [high: number, low: number] => {
  const high = Math.fround(value);
  return [high, value - high];
};

const toUniforms = ([minX, minY, maxX, maxY]: Cutline, tolerance: number): CutlineUniforms => {
  const [highX, lowX] = split(minX - tolerance);
  const [highY, lowY] = split(minY - tolerance);
  return { originHigh: [highX, highY], originLow: [lowX, lowY], size: [maxX - minX + 2 * tolerance, maxY - minY + 2 * tolerance] };
};

// Each cutline's uniforms in either space, worked out once per cutline rather than once per tile
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

// Whether deck.gl is drawing a globe, asked the way @developmentseed/deck.gl-raster asks it: only a
// GlobeViewport has a resolution
const isGlobe = (viewport: Viewport) => (viewport as { resolution?: number }).resolution !== undefined;

/**
 * A COGLayer that draws only what falls inside a box: a scanned map without its collar, or a DEM tile
 * without the pixels it shares with its neighbours.
 *
 * Done with PreciseCutline above, added to the end of whichever pipeline the layer would have drawn
 * with anyway: the one it works out from the file itself, unless it was handed one. That keeps
 * upstream's own handling of band layouts, masks and textures, rather than a copy of it that would
 * have to keep up.
 *
 * The cutline is compared with the mesh's positions as they are, so it has to be in whatever space
 * the mesh is in. On a flat map that is deck.gl's common space. On a globe RasterTileLayer builds the
 * mesh in longitude and latitude instead, so the cutline is handed over in degrees.
 *
 * Which of the two is asked tile by tile, as each one is drawn, and not once for the layer: the
 * callback this returns is kept until the layer's props change, and a viewport changing type isn't
 * one of those. deck.gl's GlobeView draws a globe through a GlobeViewport only up to zoom 12, and
 * through a WebMercatorViewport past it - so a box picked once, on the way in, would be compared
 * against every tile drawn flat after that in the wrong units, and all of them discarded.
 * RasterTileLayer picks the mesh's space at the same moment and by the same test, so the two can't
 * disagree; tiles already drawn keep the mesh and the box they were drawn with.
 *
 * It also frees what its tiles hold when it goes away, which COGLayer doesn't; see finalizeState.
 */
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

  /**
   * Free what the tiles still loaded hold, as the layer goes away.
   *
   * A tile that leaves the layer's cache is unloaded through onTileUnload, which is where COGLayer frees
   * the textures its own pipeline uploaded, and where a pipeline handed in frees its own. A tile still in
   * the cache when the layer itself is removed never is: deck.gl's TileLayer empties its tileset on
   * finalize without unloading anything in it. A COG drawn on its own is removed once per preview, but a
   * sheet of a mosaic is removed every time it leaves the view - and the textures of every sheet ever
   * panned past stayed on the GPU, a hundred or so more for each new view of an HTMC index map.
   *
   * deck.gl finalizes a layer before the layers it drew, so the tiles are all still here to unload.
   */
  finalizeState(context: LayerContext) {
    this.releaseLoadedTiles();
    super.finalizeState(context);
  }

  // Unload every tile that has something loaded, the same way the cache would have
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
