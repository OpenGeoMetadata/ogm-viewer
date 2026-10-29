import type { CachedTags, DecoderPool, GeoTIFF, Overview, RasterArray, RasterTypedArray } from '@developmentseed/geotiff';
import { Colormap, COLORMAP_INDEX, createColormapTexture, CreateTexture, LinearRescale } from '@developmentseed/deck.gl-raster/gpu-modules';
import type { RenderTileResult } from '@developmentseed/deck.gl-raster';
import type { Device, Texture } from '@luma.gl/core';

import { colormapSprite, type ColorRampName } from './colormap';

// TIFF SampleFormat tags for signed integers and floats; avoid importing a transitive dependency.
const SAMPLE_FORMAT_INT = 2;
const SAMPLE_FORMAT_FLOAT = 3;

// Single-band signed and float rasters need a scalar pipeline; upstream only infers unsigned data.
export function isScalarSampleFormat(cachedTags: CachedTags | undefined): boolean {
  if (!cachedTags || cachedTags.samplesPerPixel !== 1) return false;
  const [format] = cachedTags.sampleFormat;
  return format === SAMPLE_FORMAT_INT || format === SAMPLE_FORMAT_FLOAT;
}

export type ScalarRange = readonly [min: number, max: number];

// Sample the coarsest overview when statistics are absent to avoid reading a full-resolution raster.
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

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return widen(min, max);
}

// Widen a constant range to avoid division by zero in the shader.
function widen(min: number, max: number): ScalarRange {
  return max > min ? [min, max] : [min, min + 1];
}

export type ScalarTileData = {
  width: number;
  height: number;
  byteLength: number;
  texture: Texture;
  colormapTexture: Texture;
};

const colormapTextures = new WeakMap<Device, Texture>();

async function colormapTexture(device: Device): Promise<Texture> {
  const existing = colormapTextures.get(device);
  if (existing) return existing;

  const sprite = await colormapSprite();
  const texture = createColormapTexture(device, sprite);
  colormapTextures.set(device, texture);
  return texture;
}

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
    // Linear filtering of r32float requires the optional float32-filterable device feature.
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

// Destroy only the tile texture; the colormap texture is shared by every tile on this device.
export function releaseScalarTile(data: ScalarTileData | null | undefined) {
  data?.texture.destroy();
}

function singleBand(array: RasterArray) {
  return array.layout === 'band-separate' ? array.bands[0] : array.data;
}

function toScalarValues(raw: RasterTypedArray, nodata: number | null): Float32Array {
  if (raw instanceof Float32Array && nodata === null) return raw;

  const values = raw instanceof Float32Array ? raw.slice() : Float32Array.from(raw);
  if (nodata === null) return values;

  // Compare at float32 precision so rounded GDAL nodata text matches the stored pixels.
  // Credit: opengeos/GeoLibre, packages/map/src/cog-dem-source.ts (MIT).
  const sentinel = Math.fround(nodata);
  for (let i = 0; i < values.length; i++) {
    if (Math.fround(values[i]) === sentinel) values[i] = NaN;
  }
  return values;
}

// Nodata has been converted to NaN, which an equality-based shader filter cannot match.
export const DiscardNonFinite = {
  name: 'ogm-discard-non-finite',
  inject: {
    'fs:DECKGL_FILTER_COLOR': `
    if (isnan(color.r) || isinf(color.r)) {
      discard;
    }
    `,
  },
};

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
