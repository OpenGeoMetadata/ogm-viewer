import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

import { render as stencilRender } from '@stencil/core';

import GeoJsonPreviewer from '../../lib/previewers/geojson';
import ImagePreviewer from '../../lib/previewers/image';
import GeoJsonResource from '../../lib/resources/geojson';
import IIIFResource from '../../lib/resources/iiif';
import type { AnyPreviewer } from '../../lib/previewers/factory';
import { referenceError } from '../../lib/errors';

const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

const renderPreview = async (previewer: AnyPreviewer) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await stencilRender(<ogm-preview previewer={previewer}></ogm-preview>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  return el;
};

const mapPreviewer = () => new GeoJsonPreviewer(new GeoJsonResource('id', 'http://example.com/data.json'));

describe('ogm-preview', () => {
  it('draws a map preview with the map', async () => {
    const el = await renderPreview(mapPreviewer());
    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-image')).toBeNull();
    expect(shadowRoot.querySelector('ogm-alerts')).toBeNull();
  });

  it('draws an image preview with the image viewer', async () => {
    const el = await renderPreview(new ImagePreviewer(new IIIFResource('id', 'http://example.com/iiif/info.json')));
    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-image')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-map')).toBeNull();
  });

  it('passes cooperative gestures on to the map, on by default', async () => {
    const el = await renderPreview(mapPreviewer());
    const map = (el.shadowRoot as ShadowRoot).querySelector('ogm-map') as HTMLElement & { cooperativeGestures: boolean };
    expect(map.cooperativeGestures).toBe(true);
  });

  it('turns the map’s cooperative gestures off when asked to', async () => {
    const el = await renderPreview(mapPreviewer());
    (el as unknown as { cooperativeGestures: boolean }).cooperativeGestures = false;
    await flush();

    const map = (el.shadowRoot as ShadowRoot).querySelector('ogm-map') as HTMLElement & { cooperativeGestures: boolean };
    expect(map.cooperativeGestures).toBe(false);
  });

  it('shows the error over the preview when a previewError is reported', async () => {
    const el = await renderPreview(mapPreviewer());
    const error = referenceError(new TypeError('Failed to fetch'), 'GeoJSON', 'http://example.com/data.json');

    el.dispatchEvent(new CustomEvent('previewError', { detail: error, bubbles: true }));
    await flush();

    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-alerts')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
  });
});
