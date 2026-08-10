import type { AddLayerObject, LngLatBoundsLike } from 'maplibre-gl';
import { WarpedMapLayer } from '@allmaps/maplibre';

import MapPreviewer from './map';
import type IIIFManifestResource from '../resources/iiif-manifest';
import type { PreviewStyleLayer } from '../layers';

// Draws a georeferenced scan as a map layer, warping the IIIF image onto the control points a IIIF
// Georeference Annotation gives it. The second preview a georeferenced manifest offers: the same
// resource is also an image to page through, and each of those is its own tab.
//
// Allmaps' WarpedMapLayer is a MapLibre CustomLayerInterface, so it goes on with addLayer like any
// other layer - but it paints itself with its own WebGL, which is why opacity is a call on it rather
// than a paint property, and why it reports its style layer as 'custom'.
export default class GeoreferencePreviewer extends MapPreviewer {
  declare protected resource: IIIFManifestResource;

  // Allmaps ignores the projection matrix MapLibre hands a custom layer and works its own viewport
  // out instead: the map's centre and bearing, and a single Web Mercator units-per-pixel scale taken
  // from unprojecting the four viewport corners. That describes a flat, north-up map exactly and a
  // sphere not at all. It goes unnoticed at the zooms a scan is read at, because MapLibre's globe has
  // internally become mercator by then - measured against the true scale at the centre, the figure
  // Allmaps derives is right to within 1% at zoom 8 and 5% at zoom 6 - but by zoom 3 it is out by
  // half again, and the warped map slides off the globe. So this preview asks for the flat map it is
  // actually drawn on, and <ogm-map> takes the globe control away with it.
  readonly projection = 'mercator' as const;

  // Tilting is the same mistake by another route, that viewport having no pitch either: out by a
  // quarter at 30 degrees and more than double at 60. Nothing to fall back on, so it is held flat.
  readonly maxPitch = 0;

  // The layer currently on the map. Kept because opacity and bounds are calls on this object, and
  // MapLibre's getLayer() hands back a wrapper of its own rather than what we added.
  protected layer: WarpedMapLayer | undefined;

  // A second preview of a manifest that is already offered as an image, so it needs its own name:
  // two tabs both reading 'IIIF Manifest' would tell the user nothing.
  label() {
    return 'Georeferenced map';
  }

  // Nothing for MapLibre to fetch. The warped map layer requests the IIIF image's tiles itself,
  // through @allmaps/render, so they don't pass through MapLibre's transformRequest either.
  protected async createSources(): Promise<[]> {
    return [];
  }

  protected getLayerId(): string {
    return `${this.resource.id}-georeference`;
  }

  protected async createLayers(): Promise<AddLayerObject[]> {
    this.layer = new WarpedMapLayer({ layerId: this.getLayerId() });

    this.previewLayers.push({
      id: this.getLayerId(),
      title: this.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getLayerId(), type: 'custom' }],
    });

    return [this.layer];
  }

  // The annotation can only go on once the layer is on the map: Allmaps builds its renderer in the
  // layer's onAdd and throws if handed an annotation before there is one. MapLibre calls onAdd
  // synchronously from addLayer, so a renderer exists by the time super.preview() returns.
  async preview(): Promise<void> {
    const annotation = await this.resource.getGeoreferenceAnnotation();

    // Only reached if the manifest stopped being georeferenced between the tab being built and
    // being opened, since that check is what put this preview on offer in the first place
    if (!annotation) throw new Error('This manifest has no georeference annotation to draw.');

    await super.preview();

    // Allmaps reports per-map rather than throwing: a page of annotations can be partly readable,
    // and one bad map among several is not worth refusing to draw the rest of.
    const results = this.layer?.addGeoreferenceAnnotation(annotation) ?? [];
    const errors = results.filter((result): result is Error => result instanceof Error);

    errors.forEach(error => console.warn(`Could not read a georeferenced map in ${this.url}:`, error));
    if (errors.length === results.length) throw errors[0] ?? new Error('The georeference annotation described no maps that could be drawn.');
  }

  async clearPreview() {
    await super.clearPreview();
    this.layer = undefined;
  }

  // Opacity is the layer's own, not a paint property: MapLibre has no shader of its own for a
  // custom layer and rejects the properties a style layer would take.
  protected applyOpacity(_styleLayer: PreviewStyleLayer, opacity: number) {
    this.layer?.setOpacity(opacity);
  }

  // Allmaps works the extent out from the annotation's control points, which frames the scan far
  // more tightly than the record's own bounding box - the whole sheet, rather than the country it
  // sits in. Falls back to the record's when the annotation described nothing drawable.
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return this.layer?.getBounds() ?? (await super.getBounds());
  }
}
