import type { AddLayerObject, CustomLayerInterface, Evented, LngLatBoundsLike } from 'maplibre-gl';
import { WarpedMapLayer } from '@allmaps/maplibre';

import MapPreviewer from './map';
import { backgroundColorOf } from '../background-color';
import type IIIFManifestResource from '../resources/iiif-manifest';
import type { LayerState, PreviewStyleLayer } from '../layers';

// Allmaps' own event for the first tile of one warped map arriving. @allmaps/maplibre refires every
// event its renderer emits on the MapLibre map, tagged with the layer it came from, so this is how a
// layer that paints itself can be heard from at all. Spelled out rather than imported from
// @allmaps/render's WarpedMapEventType, which @allmaps/maplibre does not re-export.
const FIRST_TILE_EVENT = 'firstmaptileloaded';

// What @allmaps/maplibre puts on the events it refires: which of its layers the news is about, and
// which of that layer's maps. The `type` is MapLibre's own, on every event it hands a listener, and
// is here because Evented below only takes event shapes that carry one.
type WarpedMapLayerEvent = { type: string; layerId?: string; mapIds?: string[] };

// The map, as something that fires the event above. MapLibre types Evented against the events it
// knows how to fire, and this one is not among them - it is Allmaps' own, refired on our map - so
// the name has to be declared here for on() and off() to take it.
type WarpedMapEvented = Evented<Record<typeof FIRST_TILE_EVENT, WarpedMapLayerEvent>>;

// How the Allmaps Viewer tunes its own magic wand, rather than @allmaps/render's shipped defaults of
// 0.3 and 0.7. The threshold is how far a pixel may sit from the detected colour and still be taken
// away, as a Euclidean distance in fractional RGB - so on a 0 to sqrt(3) scale - and the hardness is
// how abruptly that happens at the edge: 1 is a straight cutoff, and 0.1 feathers almost the whole
// way, which is what keeps linework drawn over the paper from coming away with it.
//
// Zero threshold is not "take nothing" but "do nothing": the shader skips the entire branch unless it
// is positive, which is why switching the toggle off writes it as well as removeColor.
const REMOVE_COLOR_THRESHOLD = 1 / 3;
const REMOVE_COLOR_HARDNESS = 0.1;

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

  // Allmaps tells us when the scan's first tile lands, which no MapLibre source would; see
  // handleFirstTile
  readonly reportsDrawing = true;

  // The layer currently on the map. Kept because opacity and bounds are calls on this object, and
  // MapLibre's getLayer() hands back a wrapper of its own rather than what we added.
  protected layer: WarpedMapLayer | undefined;

  // The paper colour of each sheet this annotation describes, by the map id Allmaps gave it, once a
  // thumbnail has been read for it. An instance field rather than anything on the layer, so it
  // survives a basemap swap: setStyle() rebuilds the style document and this preview draws itself
  // into the new one from scratch, and re-fetching every thumbnail to learn the same answers again
  // would be a request per sheet per theme toggle.
  private backgroundColors = new Map<string, string>();

  // Sheets a detection is already in flight for. The image-loaded event can arrive more than once for
  // the same map - and does, on every redraw - so without this a slow thumbnail would be fetched
  // twice over.
  private detecting = new Set<string>();

  // What applyBackgroundRemoval last told the layer, or undefined if it hasn't yet. Worth a memo
  // because applyLayerState runs on every frame of an opacity drag, and each call rebuilds per-map
  // uniforms and asks for a render. Reset in createLayers(), so the first apply after a basemap swap
  // reaches the freshly built layer rather than being skipped as a repeat.
  private backgroundRemoved: boolean | undefined;

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
    this.backgroundRemoved = undefined;

    this.previewLayers.push({
      id: this.getLayerId(),
      title: this.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getLayerId(), type: 'custom' }],
      // Whether the panel has a background toggle to draw. False on a first draw, since no thumbnail
      // has been read yet, and answered from what we already know on a redraw so a basemap swap
      // doesn't take the control away and then put it back.
      backgroundRemovable: this.backgroundColors.size > 0,
    });

    // @allmaps/maplibre still types itself against MapLibre 5, so its layer is not the same
    // CustomLayerInterface ours is - the same shape, declared twice. What MapLibre asks of a custom
    // layer has not changed, and Allmaps imports the types alone: no second copy is ever loaded.
    return [this.layer as unknown as CustomLayerInterface];
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
    // and one bad map among several is not worth refusing to draw the rest of. One result per map,
    // each either an ok one naming the map it added or a failed one carrying the error.
    //
    // `=== false` rather than a plain `!result.ok`: the TypeScript Stencil compiles with narrows a
    // boolean discriminant by comparison but not by truthiness, and the repo's own newer one - what
    // `npm run lint` runs - accepts either. This form satisfies both.
    const results = this.layer?.addGeoreferenceAnnotation(annotation) ?? [];
    const errors = results.flatMap(result => (result.ok === false ? [result.error] : []));

    errors.forEach(error => console.warn(`Could not read a georeferenced map in ${this.url}:`, error));
    if (errors.length === results.length) throw errors[0] ?? new Error('The georeference annotation described no maps that could be drawn.');

    this.watchFirstTile();
  }

  // Listen for the scan's first tile. Registered here rather than in attach() so that it is paired
  // with clearPreview() below, and taken off first so a theme change - which draws the same preview
  // again into a rebuilt style document, with no clearPreview between - leaves one listener, not two.
  //
  // On the map rather than on the layer, because the layer hands its renderer's events to the map;
  // and filtered by layer, because every warped layer on this map reports through the same channel.
  protected watchFirstTile() {
    const events = this.map as unknown as WarpedMapEvented;
    events.off(FIRST_TILE_EVENT, this.handleFirstTile);
    events.on(FIRST_TILE_EVENT, this.handleFirstTile);
  }

  // A bound instance property rather than a method, so that off() above and in clearPreview() has
  // the same function to remove that on() was given
  //
  // Also where each sheet's background colour is worked out from, which is not the event it looks
  // like it should be: @allmaps/render has an `imageloaded` of its own, but @allmaps/maplibre routes
  // that one straight to its repaint and only refires a dozen others, so nothing outside the layer
  // ever hears it. This one arrives a moment later and answers the same question - a tile cannot be
  // requested before the image information that says where the tiles are - and it carries the same
  // mapIds. A sheet that never comes into view never gets a tile, and so never costs a thumbnail.
  private handleFirstTile = (event: WarpedMapLayerEvent) => {
    if (event.layerId !== this.getLayerId()) return;
    this.onDrawn?.();

    // Not awaited: nothing on the map is waiting for a colour, each sheet reports its own outcome,
    // and detectBackground swallows its own failures.
    event.mapIds?.forEach(mapId => void this.detectBackground(mapId));
  };

  // Work out one sheet's paper colour and offer the toggle once any sheet has one. Runs on its own
  // after the scan is already drawn, so a slow or missing thumbnail costs the reader the control
  // rather than the preview - which is also why a failure is warned about rather than reported
  // through onError, the way a partly-unreadable annotation is in preview() above.
  private async detectBackground(mapId: string) {
    if (this.backgroundColors.has(mapId) || this.detecting.has(mapId)) return;

    const warpedMap = this.layer?.getWarpedMap(mapId);
    if (!warpedMap || !warpedMap.hasImage()) return;

    this.detecting.add(mapId);

    try {
      // resourceMask rather than resourceFullMask: the mask is the sheet the georeferencer traced, so
      // clipping the histogram to it keeps the scanner bed, the binding and the margins out of it.
      const hexColor = await backgroundColorOf(warpedMap.image, warpedMap.resourceMask);
      this.backgroundColors.set(mapId, hexColor);

      // A sheet whose colour arrived while the toggle was already on has to be caught up on its own:
      // the panel's state won't change again by itself, so nothing else will come back for it.
      if (this.backgroundRemoved) this.layer?.setMapOptions(mapId, this.removeColorOptions(hexColor, true));

      const layer = this.previewLayers.find(previewLayer => previewLayer.id === this.getLayerId());
      if (layer && !layer.backgroundRemovable) {
        layer.backgroundRemovable = true;
        this.onLayersChanged?.();
      }
    } catch (error) {
      console.warn(`Could not work out the background color of a georeferenced map in ${this.url}:`, error);
    } finally {
      this.detecting.delete(mapId);
    }
  }

  async clearPreview() {
    if (this.attached) (this.map as unknown as WarpedMapEvented).off(FIRST_TILE_EVENT, this.handleFirstTile);
    await super.clearPreview();
    this.layer = undefined;
  }

  // Visibility is still MapLibre's to set - it honours the layout property on a custom layer - so
  // the base class keeps that half, and the background toggle is added on top of it. Overridden here
  // rather than in applyOpacity below because removal is a whole-layer setting and that seam is only
  // handed an opacity.
  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    super.applyStyleLayerState(styleLayer, state);

    // The same guard the base class makes before touching the style document, for the same window:
    // mid-rebuild this.layer is an object MapLibre has not handed a context to yet, and every call on
    // it throws 'Renderer not defined' rather than being ignored.
    if (!this.map.getLayer(styleLayer.id)) return;

    this.applyBackgroundRemoval(state.removeBackground ?? false);
  }

  // Opacity is the layer's own, not a paint property: MapLibre has no shader of its own for a
  // custom layer and rejects the properties a style layer would take.
  protected applyOpacity(_styleLayer: PreviewStyleLayer, opacity: number) {
    this.layer?.setOpacity(opacity);
  }

  // Tell every sheet whose colour we know whether to drop it. One call for the whole layer rather
  // than one per sheet: setMapsOptions takes a callback and asks it about each map in turn, so a
  // sheet still waiting on its thumbnail can be answered with undefined and left exactly as it is.
  private applyBackgroundRemoval(remove: boolean) {
    if (remove === this.backgroundRemoved) return;
    this.backgroundRemoved = remove;

    // Nothing to say yet, and the memo above is still worth writing: a colour that lands later is
    // caught up by detectBackground, and a toggle after that finds the memo already disagreeing.
    if (!this.backgroundColors.size) return;

    this.layer?.setMapsOptions(mapId => {
      const hexColor = this.backgroundColors.get(mapId);
      return hexColor === undefined ? undefined : this.removeColorOptions(hexColor, remove);
    });
  }

  // Written in one place because two callers set it: the toggle, and a sheet whose colour landed
  // after the toggle was already on.
  private removeColorOptions(hexColor: string, remove: boolean) {
    return {
      removeColor: remove,
      removeColorColor: hexColor,
      removeColorHardness: REMOVE_COLOR_HARDNESS,
      removeColorThreshold: remove ? REMOVE_COLOR_THRESHOLD : 0,
    };
  }

  // Allmaps works the extent out from the annotation's control points, which frames the scan far
  // more tightly than the record's own bounding box - the whole sheet, rather than the country it
  // sits in. Falls back to the record's when the annotation described nothing drawable.
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return this.layer?.getBounds() ?? (await super.getBounds());
  }
}
