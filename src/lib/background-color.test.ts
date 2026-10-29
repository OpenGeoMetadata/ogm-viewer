import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { backgroundColorOf, type ThumbnailSource } from './background-color';

const IMAGE_SIZE = { width: 4000, height: 3000 };
const THUMBNAIL_SIZE = { width: 512, height: 384 };

const MASK: [number, number][] = [
  [400, 300],
  [3600, 300],
  [3600, 2700],
  [400, 2700],
];

const PAPER = [240, 235, 220] as const;
const PAPER_HEX = '#f0ebdc';

const pixels = ({ width, height }: { width: number; height: number }, color: readonly number[] = PAPER): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) data.set([...color, 255], index * 4);
  data.set([10, 10, 10, 255], 0);
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
};

let readPixels: (size: { width: number; height: number }) => ImageData;

const bitmaps: { width: number; height: number; closed: boolean }[] = [];

const bitmap = (size: { width: number; height: number }) => {
  const made = { ...size, closed: false, close: () => void (made.closed = true) };
  bitmaps.push(made);
  return made;
};

type FakeCanvas = { width: number; height: number; drawn: { x: number; y: number; width: number }[]; clipped: [number, number][] };
const canvases: FakeCanvas[] = [];

const imageFor = (overrides: Partial<ThumbnailSource> = {}): ThumbnailSource => ({
  ...IMAGE_SIZE,
  getImageRequest: vi.fn(() => ({ size: THUMBNAIL_SIZE })),
  getImageUrl: vi.fn((request, options) => `https://example.org/iiif/sheet/full/${request.size?.width},${request.size?.height}/0/default.${options?.preferredFormats?.[0]}`),
  ...overrides,
});

beforeEach(() => {
  bitmaps.length = 0;
  canvases.length = 0;
  readPixels = pixels;

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, blob: async () => 'a blob' })),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap(THUMBNAIL_SIZE)),
  );

  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      readonly record: FakeCanvas;

      constructor(width: number, height: number) {
        this.record = { width, height, drawn: [], clipped: [] };
        canvases.push(this.record);
      }

      getContext() {
        const { record } = this;
        return {
          fillStyle: '',
          fillRect: () => {},
          beginPath: () => {},
          moveTo: (x: number, y: number) => record.clipped.push([x, y]),
          lineTo: (x: number, y: number) => record.clipped.push([x, y]),
          closePath: () => {},
          clip: () => {},
          drawImage: (tile: { width: number }, x: number, y: number) => record.drawn.push({ x, y, width: tile.width }),
          getImageData: () => readPixels(record),
        };
      }

      transferToImageBitmap() {
        return bitmap({ width: this.record.width, height: this.record.height });
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('backgroundColorOf', () => {
  it('asks the image service for a thumbnail, in a format smaller than the JPEG it must serve', async () => {
    const image = imageFor();
    await backgroundColorOf(image, MASK);

    expect(image.getImageRequest).toHaveBeenCalledWith({ width: 512, height: 512 });
    expect(image.getImageUrl).toHaveBeenCalledWith({ size: THUMBNAIL_SIZE }, { preferredFormats: ['webp', 'jpg'] });
    expect(fetch).toHaveBeenCalledWith('https://example.org/iiif/sheet/full/512,384/0/default.webp', undefined);
  });

  it('returns the most common color inside the mask, as hex', async () => {
    await expect(backgroundColorOf(imageFor(), MASK)).resolves.toEqual(PAPER_HEX);
  });

  it('scales the mask down into the thumbnail rather than up out of it', async () => {
    await backgroundColorOf(imageFor(), MASK);

    const scale = THUMBNAIL_SIZE.width / IMAGE_SIZE.width;
    const [read] = canvases;

    expect(read).toMatchObject(THUMBNAIL_SIZE);
    expect(read.clipped).toEqual(MASK.map(([x, y]) => [x * scale, y * scale]));

    read.clipped.forEach(([x, y]) => {
      expect(x).toBeLessThanOrEqual(THUMBNAIL_SIZE.width);
      expect(y).toBeLessThanOrEqual(THUMBNAIL_SIZE.height);
    });
  });

  it('closes the thumbnail it read, and the tiles it read it from', async () => {
    await backgroundColorOf(imageFor(), MASK);

    expect(bitmaps).toHaveLength(1);
    expect(bitmaps.every(made => made.closed)).toBe(true);
  });

  it('closes the thumbnail even when the pixels turn out to be unreadable', async () => {
    readPixels = ({ width, height }) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData;

    await expect(backgroundColorOf(imageFor(), MASK)).rejects.toThrow(/histogram is empty/i);
    expect(bitmaps.every(made => made.closed)).toBe(true);
  });

  it('raises the failure when the thumbnail does not come back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
    );

    await expect(backgroundColorOf(imageFor(), MASK)).rejects.toMatchObject({ name: 'HttpError', status: 404 });
  });

  describe('an image service that only serves tiles', () => {
    const grid = [
      [
        { region: { x: 0, y: 0, width: 2000, height: 1500 }, size: { width: 256, height: 192 } },
        { region: { x: 2000, y: 0, width: 2000, height: 1500 }, size: { width: 256, height: 192 } },
      ],
      [
        { region: { x: 0, y: 1500, width: 2000, height: 1500 }, size: { width: 256, height: 192 } },
        { region: { x: 2000, y: 1500, width: 2000, height: 1500 }, size: { width: 256, height: 192 } },
      ],
    ];

    it('stitches the tiles into one thumbnail and reads the color off that', async () => {
      const image = imageFor({ getImageRequest: vi.fn(() => grid) });
      vi.mocked(createImageBitmap).mockImplementation(async () => bitmap({ width: 256, height: 192 }) as unknown as ImageBitmap);

      await expect(backgroundColorOf(image, MASK)).resolves.toEqual(PAPER_HEX);

      expect(fetch).toHaveBeenCalledTimes(4);

      const [stitched, read] = canvases;
      expect(stitched.drawn).toEqual([
        { x: 0, y: 0, width: 256 },
        { x: 256, y: 0, width: 256 },
        { x: 0, y: 192, width: 256 },
        { x: 256, y: 192, width: 256 },
      ]);

      expect(read).toMatchObject({ width: 512, height: 384 });
    });

    it('says so when the service offered no tiles either', async () => {
      await expect(backgroundColorOf(imageFor({ getImageRequest: vi.fn(() => []) }), MASK)).rejects.toThrow(/offered no tiles/);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
