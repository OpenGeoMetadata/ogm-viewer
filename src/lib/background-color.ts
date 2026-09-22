import { detectBackgroundColor } from '@allmaps/background-color';
import { rgb } from 'd3-color';

import { fetchOrThrow } from './errors';

// The box a thumbnail is fitted into, and the fit. Both are what the Allmaps Viewer asks for, and
// they are copied rather than chosen: the colour this returns is the most common one among the pixels
// it fetched, so a different size is a different JPEG at a different scale and can land in a
// different histogram bin. Matching upstream is what makes our answer the same as theirs.
//
// `cover` - getImageRequest's own default - fits the box to the shorter side, so a wide sheet comes
// back wider than 512. More pixels than a histogram needs, and what upstream reads.
const THUMBNAIL_SIZE = { width: 512, height: 512 };

// Asked for in preference to the JPEG every Image API service must serve. Only formats the service
// advertises are used, so this is a hint rather than a requirement.
const PREFERRED_FORMATS = ['webp', 'jpg'];

// A IIIF Image API request, as @allmaps/iiif-parser describes one
type ImageRequest = { region?: { x: number; y: number; width: number; height: number }; size?: { width: number; height: number } };

// The parts of @allmaps/iiif-parser's parsed Image this module needs, declared structurally rather
// than imported: iiif-parser reaches us through @allmaps/maplibre and is no dependency of ours to
// name, and naming it would be a phantom import that holds only as long as npm keeps hoisting it.
// Saying which four members are used also says exactly what a caller has to supply, which is all a
// test has to build.
export type ThumbnailSource = {
  width: number;
  height: number;
  getImageRequest(size: { width: number; height: number }): ImageRequest | ImageRequest[][];
  getImageUrl(request: ImageRequest, options?: { preferredFormats?: string[] }): string;
};

// The colour a scanned map's paper is, as a hex string, worked out from a thumbnail of it: the most
// common colour among the pixels inside the mask the georeferencer traced. The same thing the Allmaps
// Viewer's magic wand does, and the hex is what a warped map layer's removeColorColor option takes.
//
// Fetching the thumbnail is all this does itself. The histogram is @allmaps/background-color's, which
// packages exactly it: clip to the mask, list the colours inside - every second pixel, and none of the
// transparent ones the clip left behind - bin them, and take the bin with the most in it. Written
// against stdlib's own copies of those primitives until 1.0.0-beta.2, because the package's first
// release scaled the mask by resourceSize / thumbnailWidth where it needs the reciprocal, which for
// any mask inset from the scan's edges put the clipping polygon off the canvas entirely: nothing
// drawn, every pixel transparent, and 'Histogram is empty' rather than a colour. beta.2 fixes the
// scale, and stdlib has since dropped its copies, so this is now the only place the histogram lives.
//
// The mask is handed over in the sheet's own coordinates, unscaled: the detector takes the size those
// coordinates are in and shrinks them into the thumbnail itself.
export async function backgroundColorOf(image: ThumbnailSource, resourceMask: [number, number][]): Promise<string> {
  const request = image.getImageRequest(THUMBNAIL_SIZE);

  // A service that can only serve tiles answers with a grid of them rather than one image; see
  // fetchTiledThumbnail
  const thumbnail = Array.isArray(request) ? await fetchTiledThumbnail(image, request) : await fetchThumbnail(image, request);

  try {
    const [red, green, blue] = detectBackgroundColor([image.width, image.height], thumbnail, resourceMask);
    return rgb(red, green, blue).formatHex();
  } finally {
    thumbnail.close();
  }
}

// Through fetch() and createImageBitmap() rather than an <img>, so the pixels come back readable: an
// image element taints a canvas unless the service opts in with its own CORS headers, where a fetch
// that succeeded has already proved it has them. @allmaps/render fetches this image's tiles the same
// way, so a scan that draws at all can have its thumbnail read.
//
// fetchOrThrow rather than a bare fetch so a 404 or a 500 arrives as an HttpError, the way it does
// everywhere else in this library, rather than as an undecodable body further down.
async function fetchThumbnail(image: ThumbnailSource, request: ImageRequest): Promise<ImageBitmap> {
  const response = await fetchOrThrow(image.getImageUrl(request, { preferredFormats: PREFERRED_FORMATS }));
  return createImageBitmap(await response.blob());
}

// Draw a grid of tiles into one bitmap. An Image API service that doesn't support arbitrary regions
// and sizes can't render a thumbnail at all, so iiif-parser answers with the tiles of whichever zoom
// level comes closest to the size asked for, and they have to be put back together before anything
// can read a histogram off them.
//
// Tiles are fetched one at a time rather than all at once: nothing is waiting on this - it runs after
// the scan is already on the map - and a grid can be a dozen requests to a service that has just told
// us it renders nothing on demand.
async function fetchTiledThumbnail(image: ThumbnailSource, grid: ImageRequest[][]): Promise<ImageBitmap> {
  if (!grid.length || !grid[0].length) throw new Error('This image service offered no tiles to build a thumbnail from.');

  // Each row is as tall as its own tiles and each column as wide as its own, so the top row and the
  // first column give the whole canvas. Taken from the requests rather than from the tiles as they
  // arrive, because the canvas has to exist before the first one can be drawn into it.
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
