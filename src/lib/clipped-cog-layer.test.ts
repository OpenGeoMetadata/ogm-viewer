import { describe, it, expect, vi } from '@stencil/vitest';

import ClippedCOGLayer, { cutlineUniforms, PreciseCutline, type Cutline, type CutlineUniforms } from './clipped-cog-layer';

const OWN_MODULE = { module: { name: 'own' } };
const renderTile = vi.fn(() => ({ renderPipeline: [OWN_MODULE] }));

const GLOBE = { resolution: 0 };
const FLAT = {};

const CUTLINE: Cutline = [80.123456789, 31.987654321, 81.123456789, 32.987654321];

const commonX = (lng: number) => ((lng + 180) / 360) * 512;
const commonY = (lat: number) => 256 + (256 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const reassemble = ({ originHigh, originLow, size }: CutlineUniforms) => {
  const minX = originHigh[0] + originLow[0];
  const minY = originHigh[1] + originLow[1];
  return [minX, minY, minX + size[0], minY + size[1]];
};

const layerIn = (viewport: object, cutline?: Cutline) => {
  const layer = new ClippedCOGLayer({ id: 'sheet', source: 'https://example.com/sheet.tif', getTileData: vi.fn(), renderTile, ...(cutline && { cutline }) } as never);
  Object.assign(layer, { context: { viewport } });
  return layer as unknown as {
    _renderTileCallback(): ((data: unknown) => { renderPipeline: { module: unknown; props?: CutlineUniforms }[] }) | undefined;
    context: { viewport: object };
  };
};

const DATA = { width: 512, height: 512 };

describe('ClippedCOGLayer', () => {
  it('draws exactly what it would have without a cutline', () => {
    expect(layerIn(FLAT)._renderTileCallback()).toBe(renderTile);
  });

  it('clips the pipeline it would have drawn with, after the rest of it', () => {
    const pipeline = layerIn(GLOBE, CUTLINE)._renderTileCallback()!(DATA).renderPipeline;

    expect(pipeline.map(({ module }) => module)).toEqual([OWN_MODULE.module, PreciseCutline]);
  });

  it('clips in whichever space the mesh is in', () => {
    const globe = layerIn(GLOBE, CUTLINE)._renderTileCallback()!(DATA).renderPipeline[1].props!;
    const flat = layerIn(FLAT, CUTLINE)._renderTileCallback()!(DATA).renderPipeline[1].props!;

    expect(globe).toBe(cutlineUniforms(CUTLINE, true));
    expect(flat).toBe(cutlineUniforms(CUTLINE, false));
  });

  it('asks which kind of view it is in for each tile, not once for the layer', () => {
    const layer = layerIn(GLOBE, CUTLINE);
    const render = layer._renderTileCallback()!;

    layer.context.viewport = FLAT;

    expect(render(DATA).renderPipeline[1].props).toBe(cutlineUniforms(CUTLINE, false));
  });
});

describe('cutlineUniforms', () => {
  it('hands a globe the box in degrees, let out by a few millionths of one', () => {
    const [west, south, east, north] = reassemble(cutlineUniforms(CUTLINE, true));

    expect(west).toBeLessThan(CUTLINE[0]);
    expect(west).toBeCloseTo(CUTLINE[0], 4);
    expect(south).toBeLessThan(CUTLINE[1]);
    expect(south).toBeCloseTo(CUTLINE[1], 4);
    expect(east).toBeGreaterThan(CUTLINE[2]);
    expect(east).toBeCloseTo(CUTLINE[2], 4);
    expect(north).toBeGreaterThan(CUTLINE[3]);
    expect(north).toBeCloseTo(CUTLINE[3], 4);
  });

  it('hands a flat map the box in common space, let out the same way', () => {
    const [minX, minY, maxX, maxY] = reassemble(cutlineUniforms(CUTLINE, false));

    expect(minX).toBeLessThan(commonX(CUTLINE[0]));
    expect(minX).toBeCloseTo(commonX(CUTLINE[0]), 4);
    expect(minY).toBeLessThan(commonY(CUTLINE[1]));
    expect(minY).toBeCloseTo(commonY(CUTLINE[1]), 4);
    expect(maxX).toBeGreaterThan(commonX(CUTLINE[2]));
    expect(maxX).toBeCloseTo(commonX(CUTLINE[2]), 4);
    expect(maxY).toBeGreaterThan(commonY(CUTLINE[3]));
    expect(maxY).toBeCloseTo(commonY(CUTLINE[3]), 4);
  });

  it('splits the corner into a float32 and the remainder that float32 cannot hold', () => {
    for (const globe of [true, false]) {
      const { originHigh, originLow } = cutlineUniforms(CUTLINE, globe);

      originHigh.forEach(high => expect(Math.fround(high)).toBe(high));
      originLow.forEach((low, axis) => {
        expect(low).not.toBe(0);
        expect(Math.abs(low)).toBeLessThan(Math.abs(originHigh[axis]) * 2 ** -23);
      });
    }
  });

  it('works each box out once', () => {
    expect(cutlineUniforms(CUTLINE, false)).toBe(cutlineUniforms(CUTLINE, false));
  });
});
