import { detectBackgroundColor } from '@allmaps/background-color';
import { rgb } from 'd3-color';

import { fetchOrThrow } from './errors';

// Match the Allmaps thumbnail size and fit so background detection samples the same pixels.
const THUMBNAIL_SIZE = { width: 512, height: 512 };

const PREFERRED_FORMATS = ['webp', 'jpg'];

type ImageRequest = { region?: { x: number; y: number; width: number; height: number }; size?: { width: number; height: number } };

export type ThumbnailSource = {
  width: number;
  height: number;
  getImageRequest(size: { width: number; height: number }): ImageRequest | ImageRequest[][];
  getImageUrl(request: ImageRequest, options?: { preferredFormats?: string[] }): string;
};

// The detector expects the mask in original image coordinates and scales it to the thumbnail.
export async function backgroundColorOf(image: ThumbnailSource, resourceMask: [number, number][]): Promise<string> {
  const request = image.getImageRequest(THUMBNAIL_SIZE);

  const thumbnail = Array.isArray(request) ? await fetchTiledThumbnail(image, request) : await fetchThumbnail(image, request);

  try {
    const [red, green, blue] = detectBackgroundColor([image.width, image.height], thumbnail, resourceMask);
    return rgb(red, green, blue).formatHex();
  } finally {
    thumbnail.close();
  }
}

async function fetchThumbnail(image: ThumbnailSource, request: ImageRequest): Promise<ImageBitmap> {
  const response = await fetchOrThrow(image.getImageUrl(request, { preferredFormats: PREFERRED_FORMATS }));
  return createImageBitmap(await response.blob());
}

// Tile-only IIIF services need their thumbnail tiles assembled before color detection.
async function fetchTiledThumbnail(image: ThumbnailSource, grid: ImageRequest[][]): Promise<ImageBitmap> {
  if (!grid.length || !grid[0].length) throw new Error('This image service offered no tiles to build a thumbnail from.');

  const width = grid[0].reduce((total, request) => total + (request.size?.width ?? 0), 0);
  const height = grid.reduce((total, row) => total + (row[0].size?.height ?? 0), 0);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2d context to assemble a thumbnail in.');

  let y = 0;
  for (const row of grid) {
    let x = 0;
    for (const request of row) {
      const tile = await fetchThumbnail(image, request);
      context.drawImage(tile, x, y);
      x += request.size?.width ?? tile.width;
      tile.close();
    }
    y += row[0].size?.height ?? 0;
  }

  return canvas.transferToImageBitmap();
}
