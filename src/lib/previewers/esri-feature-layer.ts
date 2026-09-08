import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import type { AddGeoJsonSourceObject } from './geojson';
import { zoomToFit } from '../maps';
import type EsriFeatureLayerResource from '../resources/esri-feature-layer';

// What the source holds at the zooms the layer isn't published to be drawn at. MapLibre still tiles
// an empty collection and still reports the tile, which is what tells <ogm-map> the preview is up -
// so a scale-gated layer settles its load deadline rather than spinning until it expires.
const NO_FEATURES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export default class EsriFeatureLayerPreviewer extends GeoJsonPreviewer {
  declare protected resource: EsriFeatureLayerResource;

  // Outside the layer's own scale window there is no visible style layer reading this source, so
  // MapLibre never loads a tile of it and never reports one - and the load deadline would expire on
  // a preview doing exactly what it was asked to. So this one answers for its own drawing, the way
  // the previews that paint their own WebGL do. See syncData.
  readonly reportsDrawing = true;

  // A record can point at the same ArcGIS service more than one way, so keep the sources distinct
  protected getSourceId(): string {
    return `${this.resource.id}-esri-feature-layer`;
  }

  // The source goes on empty and is filled once the camera is somewhere the features are meant to
  // be drawn. Reading them here instead would spend a whole layer's worth of requests before
  // finding out whether any of it was going to be drawn at all.
  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'geojson',
        data: NO_FEATURES,
        generateId: true, // autogenerate feature IDs for labeling
      },
    ];
  }

  // Hide the style layers outside the window as well as leaving the source empty there. Both,
  // because either alone leaves something wrong: without this, features already read stay drawn
  // after the camera leaves the window; without the read gate, the whole layer is downloaded to
  // draw nothing.
  protected async zoomRange() {
    return await this.resource.getZoomRange();
  }

  async preview(): Promise<void> {
    await super.preview();
    await this.applyZoomFloor();
    this.watchCamera();
    await this.syncData();
  }

  async clearPreview(): Promise<void> {
    this.stopWatching();
    await super.clearPreview();
  }

  // Hold the map to the layer's own floor, but only while the whole layer still fits on screen
  // there - see MapPreviewer.minZoom for why the extent wins when the two disagree. Answered fresh
  // on every draw, because the canvas the fit is measured against can have been resized since.
  protected async applyZoomFloor() {
    this.minZoom = undefined;

    const { minzoom } = await this.resource.getZoomRange();
    if (minzoom === undefined) return;

    const bounds = await this.resource.getBounds();
    if (!bounds) return;

    const fit = zoomToFit(this.map, bounds);
    if (fit !== undefined && fit >= minzoom) this.minZoom = minzoom;
  }

  // Listen for the camera crossing into or out of the layer's scale window. Taken off first, so a
  // theme change - which draws this preview again into a rebuilt style document, with no
  // clearPreview between - leaves one listener rather than two, as GeoreferencePreviewer does.
  //
  // Also on the map's own teardown, because clearPreview isn't reached on every path a preview
  // comes down by: <ogm-viewer> takes the whole map away instead. A callback outliving its map asks
  // a map with no style document for a source, which throws rather than answering undefined.
  protected watchCamera() {
    this.map.off('zoomend', this.handleCameraChange);
    this.map.on('zoomend', this.handleCameraChange);
    this.map.off('remove', this.stopWatching);
    this.map.once('remove', this.stopWatching);
  }

  // Bound instance properties rather than methods, so off() has the same function to remove that
  // on() was given
  private stopWatching = () => {
    if (!this.map) return;
    this.map.off('zoomend', this.handleCameraChange);
    this.map.off('remove', this.stopWatching);
  };

  private handleCameraChange = () => {
    void this.syncData();
  };

  // Fetch the attributes the features were read without. A layer small enough to hold whole was
  // read with all of them and needs no request; a larger one carries only what the map draws with,
  // which is a twelfth of the bytes and everything a reader wants to see once they click.
  //
  // A failure leaves the features as they came, so the popup opens on the ObjectID rather than not
  // opening: <ogm-map> already treats a failed inspection as one unanswered click.
  async expandFeatures(features: MapGeoJSONFeature[]): Promise<MapGeoJSONFeature[]> {
    if (features.length === 0 || (await this.resource.readsAllFields())) return features;

    const ids = features.map(feature => feature.id).filter((id): id is string | number => id !== undefined);
    const attributes = await this.resource.getAttributes(ids).catch(error => {
      console.warn(`Could not read the attributes of a feature of ${this.resource.url}:`, error);
      return new Map<string | number, GeoJSON.GeoJsonProperties>();
    });

    return features.map(feature => {
      const found = feature.id === undefined ? undefined : attributes.get(feature.id);
      if (!found) return feature;

      // A copy that keeps its prototype, and written to rather than the original. A rendered
      // feature holds its coordinates in _geometry behind a getter, so a plain spread of one comes
      // out with no geometry at all; and the properties object it carries is the one MapLibre's own
      // tile cache is holding, so assigning into that would be assigning into the cache.
      const expanded = Object.assign(Object.create(Object.getPrototypeOf(feature)) as MapGeoJSONFeature, feature);
      expanded.properties = found;
      return expanded;
    });
  }

  // Draw the features if the camera is somewhere they belong, and say why not if it isn't. The
  // resource memoizes them, so crossing back into the window costs nothing.
  protected async syncData(): Promise<void> {
    if (!this.attached) return;

    const { minzoom, maxzoom } = await this.resource.getZoomRange();
    const zoom = this.map.getZoom();

    // The same comparisons MapLibre makes against a style layer's own window, so the notice and the
    // drawing agree about which side of it the camera is on
    if (minzoom !== undefined && zoom < minzoom) return this.settle('Zoom in to see this layer’s features.');
    if (maxzoom !== undefined && zoom >= maxzoom) return this.settle('Zoom out to see this layer’s features.');

    const data = await this.resource.getData();

    // Awaiting the read gave the map time to come down, or the reader time to leave the window
    if (!this.attached) return;

    const source = this.map.getSource(this.getSourceId()) as GeoJSONSource | undefined;
    source?.setData(data);

    this.onNotice?.(this.resource.truncated ? `Showing the first ${this.resource.featuresRead.toLocaleString()} features of this layer.` : undefined);
  }

  // Tell the reader why the map is empty, and whoever is drawing this that it is as drawn as it is
  // going to get - drawing nothing is the whole of what the service asked for here
  private settle(notice: string) {
    this.onNotice?.(notice);
    this.onDrawn?.();
  }
}
