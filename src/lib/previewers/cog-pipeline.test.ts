import { describe, it, expect, vi, afterEach } from 'vitest';

import { isScalarSampleFormat, scalarRange, scalarGetTileData, scalarRenderTile, DiscardNonFinite, type ScalarTileData } from './cog-pipeline';

// colormapSprite() goes through decodeColormapSprite, which needs createImageBitmap and
// OffscreenCanvas - absent in this project's node test environment, and beside the point here
// anyway: what matters to cog-pipeline.ts is only that it gets an ImageData-shaped object back.
// createColormapTexture is left real; it does nothing FakeDevice.createTexture can't stand in for.
const FAKE_SPRITE = { width: 256, height: 107, data: new Uint8ClampedArray(256 * 107 * 4) } as ImageData;
vi.mock('../colormap', async importOriginal => ({ ...(await importOriginal()), colormapSprite: vi.fn(async () => FAKE_SPRITE) }));

// SampleFormat values, matching the ones cog-pipeline.ts hardcodes
const UINT = 1;
const INT = 2;
const FLOAT = 3;

const cachedTags = (sampleFormat: number[], samplesPerPixel: number) => ({ sampleFormat, samplesPerPixel }) as never;

describe('isScalarSampleFormat', () => {
  it('is false with nothing to read', () => {
    expect(isScalarSampleFormat(undefined)).toBe(false);
  });

  // Ordinary RGB/RGBA imagery - already drawn by upstream's own pipeline
  it('is false for more than one band, whatever the sample format', () => {
    expect(isScalarSampleFormat(cachedTags([FLOAT], 3))).toBe(false);
  });

  // Unsigned integers are what inferRenderPipeline already handles - nothing for this pipeline to do
  it('is false for a single unsigned-integer band', () => {
    expect(isScalarSampleFormat(cachedTags([UINT], 1))).toBe(false);
  });

  it('is true for a single signed-integer band', () => {
    expect(isScalarSampleFormat(cachedTags([INT], 1))).toBe(true);
  });

  it('is true for a single float band', () => {
    expect(isScalarSampleFormat(cachedTags([FLOAT], 1))).toBe(true);
  });
});

// Stands in for a GeoTIFF or Overview: fetchTile is the only method scalarRange and
// scalarGetTileData call on it.
const fakeImage = (array: Partial<ScalarTileData> & Record<string, unknown>) => ({
  fetchTile: vi.fn(async () => ({ array })),
});

describe('scalarRange', () => {
  it("reads the band's own statistics without fetching a tile", async () => {
    const geotiff = {
      gdalMetadata: { bandStatistics: new Map([[1, { min: -184.48, max: 607.27, mean: null, std: null, validPercent: null }]]) },
      overviews: [fakeImage({})],
      fetchTile: vi.fn(),
    };

    expect(await scalarRange(geotiff as never)).toEqual([-184.48, 607.27]);
    expect(geotiff.overviews[0].fetchTile).not.toHaveBeenCalled();
  });

  it('samples the coarsest overview when the file has no statistics of its own', async () => {
    const coarsest = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([1, 2, 3, 100]), nodata: null } as never);
    const geotiff = { gdalMetadata: null, overviews: [fakeImage({}), coarsest], fetchTile: vi.fn() };

    expect(await scalarRange(geotiff as never)).toEqual([1, 100]);
    expect(coarsest.fetchTile).toHaveBeenCalledWith(0, 0, { boundless: false, pool: undefined });
  });

  it('falls back to the full-resolution image when there are no overviews at all', async () => {
    const fetchTile = vi.fn(async () => ({ array: { layout: 'pixel-interleaved', data: Float32Array.from([5, 6]), nodata: null } }));
    const geotiff = { gdalMetadata: null, overviews: [], fetchTile };

    expect(await scalarRange(geotiff as never)).toEqual([5, 6]);
    expect(fetchTile).toHaveBeenCalledWith(0, 0, { boundless: false, pool: undefined });
  });

  // The GeoLibre/Math.fround case: a sentinel whose decimal text parses to a float64 that never
  // equals the pixel's own float32 value unless both are compared at float32 precision
  it('excludes nodata written at less precision than the pixel it matches', async () => {
    const trueSentinel = Math.fround(-3.4028235e38);
    const coarsest = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([trueSentinel, 10, 20]), nodata: -3.4028235e38 } as never);
    const geotiff = { gdalMetadata: null, overviews: [coarsest], fetchTile: vi.fn() };

    expect(await scalarRange(geotiff as never)).toEqual([10, 20]);
  });

  it('excludes non-finite samples alongside nodata', async () => {
    const coarsest = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([NaN, 3, 4, Infinity]), nodata: null } as never);
    const geotiff = { gdalMetadata: null, overviews: [coarsest], fetchTile: vi.fn() };

    expect(await scalarRange(geotiff as never)).toEqual([3, 4]);
  });

  // LinearRescale divides by (max - min); a flat raster would otherwise divide by zero
  it('widens a flat range so the ramp has a span to stretch across', async () => {
    const geotiff = { gdalMetadata: { bandStatistics: new Map([[1, { min: 42, max: 42, mean: null, std: null, validPercent: null }]]) }, overviews: [], fetchTile: vi.fn() };

    expect(await scalarRange(geotiff as never)).toEqual([42, 43]);
  });

  it('answers a default range rather than an inverted one when every sample was excluded', async () => {
    const coarsest = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([NaN, NaN]), nodata: null } as never);
    const geotiff = { gdalMetadata: null, overviews: [coarsest], fetchTile: vi.fn() };

    expect(await scalarRange(geotiff as never)).toEqual([0, 1]);
  });
});

// Enough of a luma.gl Device for scalarGetTileData: it only calls createTexture and
// isTextureFormatFilterable, and records what it was given.
class FakeDevice {
  filterable = true;
  textures: { format: string; sampler: unknown; data: unknown }[] = [];

  isTextureFormatFilterable() {
    return this.filterable;
  }

  createTexture(options: { format: string; sampler: unknown; data: unknown }) {
    const texture = { ...options };
    this.textures.push(texture);
    return texture;
  }
}

describe('scalarGetTileData', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the tile at the given coordinates through the given pool', async () => {
    const device = new FakeDevice();
    const pool = { decode: vi.fn() } as never;
    const image = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([1, 2]), width: 2, height: 1, nodata: null } as never);

    await scalarGetTileData(image as never, { device: device as never, x: 3, y: 4, pool });

    expect(image.fetchTile).toHaveBeenCalledWith(3, 4, { boundless: false, pool, signal: undefined });
  });

  it('uploads a band-separate tile as one r32float texture', async () => {
    const device = new FakeDevice();
    const image = fakeImage({ layout: 'band-separate', bands: [Float32Array.from([1, 2, 3, 4])], width: 2, height: 2, nodata: null } as never);

    const data = await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });

    // The tile's own texture, plus the shared colormap sprite texture created alongside it
    expect(device.textures).toHaveLength(2);
    expect(device.textures[0].format).toEqual('r32float');
    expect([...(device.textures[0].data as Float32Array)]).toEqual([1, 2, 3, 4]);
    expect(data.width).toEqual(2);
    expect(data.height).toEqual(2);
    expect(data.byteLength).toEqual(16);
  });

  it('rewrites nodata to NaN before it reaches the texture', async () => {
    const device = new FakeDevice();
    const image = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([-9999, 5]), width: 2, height: 1, nodata: -9999 } as never);

    await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });

    const [first, second] = device.textures[0].data as Float32Array;
    expect(first).toBeNaN();
    expect(second).toEqual(5);
  });

  it('widens signed integer samples to float32', async () => {
    const device = new FakeDevice();
    const image = fakeImage({ layout: 'pixel-interleaved', data: Int16Array.from([-32768, 32767]), width: 2, height: 1, nodata: null } as never);

    await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });

    expect(device.textures[0].data).toBeInstanceOf(Float32Array);
    expect([...(device.textures[0].data as Float32Array)]).toEqual([-32768, 32767]);
  });

  it('filters linearly when the device supports it', async () => {
    const device = new FakeDevice();
    const image = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([1]), width: 1, height: 1, nodata: null } as never);

    await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });

    expect(device.textures[0].sampler).toEqual({ minFilter: 'linear', magFilter: 'linear' });
  });

  // r32float is unfilterable-float without the device feature; sampling it as linear anyway reads
  // as black rather than refusing to draw, so nearest is the fallback rather than a thrown error.
  it('falls back to nearest filtering when the device does not', async () => {
    const device = new FakeDevice();
    device.filterable = false;
    const image = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([1]), width: 1, height: 1, nodata: null } as never);

    await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });

    expect(device.textures[0].sampler).toEqual({ minFilter: 'nearest', magFilter: 'nearest' });
  });

  it('shares one colormap texture across tiles decoded on the same device', async () => {
    const device = new FakeDevice();
    const image = fakeImage({ layout: 'pixel-interleaved', data: Float32Array.from([1]), width: 1, height: 1, nodata: null } as never);

    const first = await scalarGetTileData(image as never, { device: device as never, x: 0, y: 0 });
    const second = await scalarGetTileData(image as never, { device: device as never, x: 1, y: 0 });

    expect(first.colormapTexture).toBe(second.colormapTexture);
    // One for each tile's own data, plus exactly one for the shared colormap sprite
    expect(device.textures).toHaveLength(3);
  });
});

describe('scalarRenderTile', () => {
  const data: ScalarTileData = { width: 1, height: 1, byteLength: 4, texture: { name: 'tile' } as never, colormapTexture: { name: 'sprite' } as never };

  // scalarRenderTile(ramp, range) itself returns the renderTile function COGLayer wants, which
  // takes a tile's ScalarTileData and only then produces a pipeline - so every test here has to
  // call the result, not just build it.
  const pipeline = (ramp: Parameters<typeof scalarRenderTile>[0], range: Parameters<typeof scalarRenderTile>[1]) => {
    // Non-null: RenderTileResult is a union with an image-only branch that has no renderPipeline,
    // but scalarRenderTile's own result is always the renderPipeline branch - that's the fact under
    // test, and the whole reason to import RenderTileResult would be to re-widen away from it.
    return scalarRenderTile(ramp, range)(data).renderPipeline!;
  };

  it('orders the pipeline: texture, discard, rescale, then colormap', () => {
    const renderPipeline = pipeline('viridis', [0, 1]);

    expect(renderPipeline.map(({ module }) => module.name)).toEqual(['create-texture-unorm', 'ogm-discard-non-finite', 'linearRescale', 'colormap']);
  });

  it('passes the tile texture and the shared colormap texture through unchanged', () => {
    const [texture, , , colormap] = pipeline('viridis', [0, 1]);

    expect(texture.props).toMatchObject({ textureName: data.texture });
    expect(colormap.props).toMatchObject({ colormapTexture: data.colormapTexture });
  });

  it("resolves the ramp's own row in the sprite", () => {
    const [, , , viridis] = pipeline('viridis', [0, 1]);
    const [, , , greys] = pipeline('greys', [0, 1]);

    expect(viridis.props).toMatchObject({ colormapIndex: 100 });
    expect(greys.props).toMatchObject({ colormapIndex: 40 });
  });

  it('stretches the given range across 0-1', () => {
    const [, , rescale] = pipeline('viridis', [-184.48, 607.27]);

    expect(rescale.props).toMatchObject({ rescaleMin: -184.48, rescaleMax: 607.27 });
  });
});

describe('DiscardNonFinite', () => {
  // Not runnable GLSL in a unit test - this only guards against losing the substance of the
  // module while editing around it.
  it('discards both NaN and infinite values', () => {
    const injected = DiscardNonFinite.inject['fs:DECKGL_FILTER_COLOR'];

    expect(injected).toContain('isnan(color.r)');
    expect(injected).toContain('isinf(color.r)');
    expect(injected).toContain('discard');
  });
});
