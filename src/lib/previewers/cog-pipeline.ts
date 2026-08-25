import type { CachedTags, DecoderPool, GeoTIFF, Overview, RasterArray, RasterTypedArray } from '@developmentseed/geotiff';
import { Colormap, COLORMAP_INDEX, createColormapTexture, CreateTexture, LinearRescale } from '@developmentseed/deck.gl-raster/gpu-modules';
import type { RenderTileResult } from '@developmentseed/deck.gl-raster';
import type { Device, Texture } from '@luma.gl/core';

import { colormapSprite, type ColorRampName } from '../colormap';

// SampleFormat values, from @cogeotiff/core's enum - hardcoded rather than imported for the same
// reason src/lib/lerc.ts hardcodes LERC's compression tag: this library doesn't depend on
// @cogeotiff/core directly, and these two numbers are unlikely to move.
const SAMPLE_FORMAT_INT = 2;
const SAMPLE_FORMAT_FLOAT = 3;

// Whether a GeoTIFF's samples are read off a color ramp rather than shown as-is: a single band of
// signed integers or floats, which @developmentseed/deck.gl-geotiff's own inferRenderPipeline
// refuses outright - "Inferring render pipeline for non-unsigned integers not yet supported" - and
// which is what most non-imagery COGs actually are: elevation, temperature, an index like NDVI.
// Multi-band data and unsigned integers (ordinary RGB/RGBA imagery, palette rasters) are left to
// upstream's own pipeline, which already draws them.
export function isScalarSampleFormat(cachedTags: CachedTags | undefined): boolean {
  if (!cachedTags || cachedTags.samplesPerPixel !== 1) return false;
  const [format] = cachedTags.sampleFormat;
  return format === SAMPLE_FORMAT_INT || format === SAMPLE_FORMAT_FLOAT;
}

// The value range a scalar layer's ramp is stretched across - see scalarRange below for how it's
// found. Read-only past this point: nothing here recomputes it per tile.
export type ScalarRange = readonly [min: number, max: number];

// The band's own pre-existing statistics when the file carries them (most COGs written by GDAL do),
// or a value range sampled from the coarsest overview when it doesn't. Never the full resolution
// image: a DEM the size of a state is exactly the case a fallback like this has to stay cheap for,
// and the coarsest overview is already downsampled to a handful of tiles - one, for the COG this was
// measured against, at 131ms including the network read.
export async function scalarRange(geotiff: GeoTIFF, pool?: DecoderPool): Promise<ScalarRange> {
  const stats = geotiff.gdalMetadata?.bandStatistics.get(1);
  if (stats && stats.min !== null && stats.max !== null) return widen(stats.min, stats.max);

  const coarsest = geotiff.overviews.at(-1) ?? geotiff;
  const tile = await coarsest.fetchTile(0, 0, { boundless: false, pool });
  const values = singleBand(tile.array);
  const sentinel = tile.array.nodata === null ? null : Math.fround(tile.array.nodata);

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (sentinel !== null && Math.fround(value) === sentinel) continue;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Every sampled pixel was nodata or non-finite - a mask that happens to blank the one tile this
  // reads from, most likely. [0, 1] is as good a guess as any and, unlike leaving min > max, doesn't
  // divide LinearRescale by a negative span.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return widen(min, max);
}

// A flat raster - every sampled pixel the same value - would otherwise hand LinearRescale a span of
// zero, dividing by it in the shader for every pixel. Widened rather than left, so a single-valued
// layer still draws in the ramp's first color instead of NaN.
function widen(min: number, max: number): ScalarRange {
  return max > min ? [min, max] : [min, min + 1];
}

// Everything a scalar tile needs GPU-side: the tile's own values, uploaded once as a texture no
// ramp choice ever has to re-upload, and the ramp sprite every scalar layer on the page shares.
export type ScalarTileData = {
  width: number;
  height: number;
  byteLength: number;
  texture: Texture;
  colormapTexture: Texture;
};

// One colormap texture per Device, not per tile or per layer: the sprite is the same 107 ramps
// whichever layer is asking, and re-uploading it on every tile would be paying GPU memory bandwidth
// for a texture that never changes. A Device is not disposed of by anything in this library, so
// nothing here has to be either.
const colormapTextures = new WeakMap<Device, Texture>();

async function colormapTexture(device: Device): Promise<Texture> {
  const existing = colormapTextures.get(device);
  if (existing) return existing;

  const sprite = await colormapSprite();
  const texture = createColormapTexture(device, sprite);
  colormapTextures.set(device, texture);
  return texture;
}

// Fetches, decodes and uploads one tile of a scalar COG - the getTileData half of the pair COGLayer
// wants; see scalarRenderTile for the other half. Stable across every render a scalar layer goes
// through: nothing it does depends on which ramp is currently selected, only on the tile itself, so
// there is nothing to gain and tiles already decoded to lose by rebuilding this per ramp change. The
// pool, the device and even the image (a GeoTIFF or one of its Overviews) all arrive as arguments -
// COGLayer resolves which overview level a tile belongs to before calling this.
export async function scalarGetTileData(
  image: GeoTIFF | Overview,
  options: { device: Device; x: number; y: number; signal?: AbortSignal; pool?: DecoderPool },
): Promise<ScalarTileData> {
  const { device, x, y, signal, pool } = options;
  const tile = await image.fetchTile(x, y, { boundless: false, pool, signal });
  const { array } = tile;
  const values = toScalarValues(singleBand(array), array.nodata);
  const filterable = device.isTextureFormatFilterable('r32float');
  const texture = device.createTexture({
    data: values,
    format: 'r32float',
    width: array.width,
    height: array.height,
    // r32float is not linearly filterable without the float32-filterable device feature (WebGL2's
    // OES_texture_float_linear) - unfiltered, sampling it at a zoom between tile levels reads as
    // block edges rather than a smooth gradient, so nearest is the fallback, not a refusal to draw.
    sampler: filterable ? { minFilter: 'linear', magFilter: 'linear' } : { minFilter: 'nearest', magFilter: 'nearest' },
  });

  return {
    width: array.width,
    height: array.height,
    byteLength: values.byteLength,
    texture,
    colormapTexture: await colormapTexture(device),
  };
}

// A single band's samples, however the decoder answered: band-separate (LERC always does, and
// PlanarConfiguration=2 does for any codec) or pixel-interleaved (everything else, and LERC's own
// codec output for a one-band file is identical either way - there is only one band to separate).
// @developmentseed/geotiff's own toBandSeparate() does this generally, for any band count, but isn't
// part of its published API - only its own decoders reach for it - so this is the one-band case of
// the same idea, small enough to own here.
function singleBand(array: RasterArray) {
  return array.layout === 'band-separate' ? array.bands[0] : array.data;
}

// Widens integer samples to float, and rewrites nodata to NaN so DiscardNonFinite below can drop it
// on the GPU without a value comparison of its own - see that module for why an exact comparison in
// the shader is the wrong tool. Left alone (same reference, no copy) when it's already Float32 with
// no nodata to rewrite, which is the common case for a DEM: nothing here needs to touch memory that
// doesn't need touching.
//
// Signed integers arrive here because @developmentseed/geotiff's decoders answer band-separate for
// LERC regardless of layout, and there is no unsigned-texture format upstream's CreateTexture
// declares a sampler for (that would need isampler2D/usampler2D) - so both scalar cases upload as
// float, or not at all. Widening loses no precision for anything this pipeline draws: display, not
// scientific recomputation, and the values involved are far inside float32's exactly-representable
// integer range.
function toScalarValues(raw: RasterTypedArray, nodata: number | null): Float32Array {
  if (raw instanceof Float32Array && nodata === null) return raw;

  const values = raw instanceof Float32Array ? raw.slice() : Float32Array.from(raw);
  if (nodata === null) return values;

  // Compared at float32 precision, not as the float64 `nodata` parses to: GDAL_NODATA is decimal
  // text, and a sentinel written with too few digits parses to a float64 that never equals the
  // float32 value the pixel actually holds once it's upconverted to a JS double - "-3.4028235e+38"
  // reads as that exact float64, while the pixel's true value is -3.4028234663852886e+38. Comparing
  // both at float32 makes them meet either way. (Credit: this exact failure mode, and this fix, are
  // documented in packages/map/src/cog-dem-source.ts of opengeos/GeoLibre, MIT licensed.)
  const sentinel = Math.fround(nodata);
  for (let i = 0; i < values.length; i++) {
    if (Math.fround(values[i]) === sentinel) values[i] = NaN;
  }
  return values;
}

// A shader module of our own, alongside the published ones in @developmentseed/deck.gl-raster: that
// package ships FilterNoDataVal for this job, but it discards by an exact GPU `==` against a single
// uniform, which is exactly the comparison toScalarValues above avoids doing on the CPU and for the
// same reason - and `==` never matches NaN regardless, so it couldn't discard what toScalarValues
// produces even if the precision problem didn't exist. Nodata is already NaN in the texture by the
// time this runs; discarding is just noticing that.
export const DiscardNonFinite = {
  name: 'ogm-discard-non-finite',
  inject: {
    // isnan/isinf are GLSL ES 3.00 builtins, which this pipeline already requires: Colormap injects
    // `precision highp sampler2DArray`, a type that doesn't exist below ES 3.00 (WebGL1). Nothing
    // upstream produces Infinity - toScalarValues only ever writes finite samples or NaN - but a
    // consumer's own values are read here too, and isinf costs nothing to also check for.
    'fs:DECKGL_FILTER_COLOR': `
    if (isnan(color.r) || isinf(color.r)) {
      discard;
    }
    `,
  },
};

// Builds the renderTile half of the pair COGLayer wants, closed over the one layer's current ramp
// and value range - the two things a ramp change actually is. Rebuilt on every such change, unlike
// scalarGetTileData: a fresh function here costs nothing tiles already decoded, because it never
// touches the tile cache, only the shader pipeline drawn from it - see the note on updateTriggers
// where this is called, in src/lib/previewers/cog-deck.ts.
export function scalarRenderTile(ramp: ColorRampName, range: ScalarRange): (data: ScalarTileData) => RenderTileResult {
  const colormapIndex = COLORMAP_INDEX[ramp];
  const [rescaleMin, rescaleMax] = range;

  return data => ({
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      { module: DiscardNonFinite },
      { module: LinearRescale, props: { rescaleMin, rescaleMax } },
      { module: Colormap, props: { colormapTexture: data.colormapTexture, colormapIndex } },
    ],
  });
}
