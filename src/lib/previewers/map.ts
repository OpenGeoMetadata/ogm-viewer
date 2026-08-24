import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';

import type Resource from '../resources/resource';

import Previewer from './previewer';
import { isLayerDrawn, resolveLayerState, type LayerState, type Layer, type PreviewStyleLayer } from '../layers';
import { type MapLibreStyle } from '../themes/maplibre';

// MapLibre doesn't bundle the id with the source, but we need to
type AddSourceObject = SourceSpecification & { id: string };

// How the map itself is drawn. A globe unless a preview can't be shown on one.
export type MapProjection = 'globe' | 'mercator';

export default abstract class MapPreviewer extends Previewer {
  readonly renderer = 'map' as const;

  // The projection this preview needs. Globe reads better for anything worldwide, so it's the default
  // and everything MapLibre draws itself keeps it. The two previews that paint with their own WebGL
  // both ask for a flat map instead, for their own reasons: deck.gl's tile layers have no bounding
  // volume implemented for a globe view and report an error every frame they try to cull against one,
  // and Allmaps works its viewport out as though the map were flat. <ogm-map> hides the globe control
  // for anything but 'globe', so a preview can't be put back into a projection it isn't drawn in.
  readonly projection: MapProjection = 'globe';

  // How long this preview has to put something on the map before whoever draws it calls the load a
  // failure. Only a floor on patience, not a cap: the deadline is cleared by the first tile that
  // arrives, so this is how long a preview has to show one sign of life, not how long it has to
  // finish. A preview that is slow by nature can raise it. See <ogm-map>'s startLoadDeadline for why
  // waiting on the browser instead isn't enough.
  readonly loadTimeout: number = 20_000;

  // How far this preview can be tilted, for the one that can't be tilted as far as MapLibre allows.
  // Allmaps' viewport takes a bearing but no pitch, so a tilted map draws the warped scan at the wrong
  // scale - out by a quarter at 30 degrees. deck.gl is handed the whole view state and needs nothing
  // here. Left undefined otherwise, which is what MapLibre reads as its own default, so there is no
  // limit of ours to keep in step with theirs.
  readonly maxPitch?: number;

  // Only what every preview on a map needs, which is somewhere to point: not MapResource, because
  // not everything drawn on a map is a tile source. A georeferenced scan is a IIIF manifest with
  // control points, with no tile URL or vector/raster distinction to offer. Subclasses that do want
  // one narrow this to the resource they actually read.
  declare protected resource: Resource;

  // Set by attach(), before anything is drawn. Not constructor arguments: the map is built by
  // ogm-map once its own element exists, long after a record's previews have been worked out, and
  // setStyle() hands back a different style on every theme change.
  protected style: MapLibreStyle;
  protected map: maplibregl.Map;

  // Where a failure that arrives after preview() has already resolved goes. Everything MapLibre
  // draws itself reports one on the map, which ogm-map is already listening to; a preview that
  // paints with its own WebGL has no such channel, so it is handed one. Set by whoever draws this
  // preview, and only worth reporting for the failures that mean the preview isn't there - see
  // DeckCogPreviewer, which has tiles arriving one at a time and most of a viewport's worth of
  // failures to say nothing about.
  onError?: (error: unknown) => void;

  // Where a preview that draws itself says it has drawn something, and the counterpart to onError
  // above: the same two previews that have no MapLibre source to fail on have none to succeed on
  // either, so the news that they are really on the map has to come from them. Everything MapLibre
  // draws is watched through the map's own tile events instead. Set by whoever draws this preview.
  onDrawn?: () => void;

  // Whether this preview answers for its own drawing through onDrawn. Read rather than assumed,
  // because the alternative is worse in both directions: a preview held to a deadline it has no way
  // to satisfy would be called broken while it draws, and one exempted by mistake goes back to
  // failing silently. See <ogm-map>'s startLoadDeadline.
  readonly reportsDrawing: boolean = false;

  // Stored state for added MapLibre sources and layers to allow for cleanup
  sourceIds: string[] = [];
  layerIds: string[] = [];

  // The logical layers this preview offers the user, in the order they're painted. Subclasses
  // fill this in from createLayers(), which is the only code that knows how one resource expands
  // into style layers.
  previewLayers: Layer[] = [];

  // A memo of the last instruction applyLayerState was given, not a source of truth: ogm-map owns
  // the user's choices, because setStyle empties the style document on every theme change and
  // every layer they were made about is drawn again from scratch.
  private layerState: ReadonlyMap<string, LayerState> = new Map();

  // Bind this preview to the map it draws on and the colors it draws with. Returns itself so a
  // caller can build and bind in one breath.
  attach(map: maplibregl.Map, style: MapLibreStyle): this {
    this.map = map;
    this.style = style;
    return this;
  }

  // Whether this preview has a map to draw on yet. One built for a tab whose map never finished
  // loading has nothing on any map to clean up.
  protected get attached(): boolean {
    return this.map !== undefined;
  }

  // Add source and preview layers if they don't already exist
  async preview(): Promise<void> {
    // A preview is drawn more than once: setStyle() rebuilds the style document and takes every
    // source and layer on it away, and the same previewer draws itself into the new one. What we
    // record has to describe the document in front of us, not every document we've ever drawn
    // into, so it starts empty each time rather than accumulating a copy per draw.
    this.sourceIds = [];
    this.layerIds = [];
    this.previewLayers = [];

    const sources = await this.createSources();

    sources.forEach(source => {
      const { id, ...sourceSpec } = source as AddSourceObject;
      // Recorded either way: a source already under this id is one we put there - ids carry the
      // resource's own id - and clearPreview still has to take it back out.
      this.sourceIds.push(id);
      if (this.map.getSource(id)) return;
      this.map.addSource(id, sourceSpec);
    });

    const layers = await this.createLayers();

    layers.forEach(layer => {
      this.layerIds.push(layer.id);
      const existing = this.map.getLayer(layer.id);

      // A style layer describes itself completely, so one already under this id is one we put there
      // and adding it again would change nothing.
      if (existing && layer.type !== 'custom') return;

      // A custom layer is not a description but an object, holding its own WebGL and its own data,
      // and MapLibre only hands it a context in onAdd. setStyle() keeps custom layers rather than
      // clearing them with the rest of the document, so after a basemap swap there is a live one
      // here already - and skipping for it would leave that one drawing while the one we just built
      // never got a context at all. Replace it instead.
      if (existing) this.map.removeLayer(layer.id);
      this.map.addLayer(layer);
    });
  }

  // Remove preview layers and sources
  async clearPreview() {
    if (!this.attached) return;

    this.layerIds.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    this.layerIds = [];

    this.sourceIds.forEach(sourceId => {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    });
    this.sourceIds = [];
    this.previewLayers = [];
    this.layerState = new Map();
  }

  // Push the user's choices onto the layers already on the map. Idempotent: every value is
  // rebuilt from the theme and the requested state rather than read back off the map, so
  // re-applying it - after a basemap swap, or on every frame of a slider drag - can't compound.
  // Callers must only call this once the style document itself has loaded, since setPaintProperty
  // throws before that.
  applyLayerState(states: ReadonlyMap<string, LayerState>) {
    this.layerState = states;

    this.previewLayers.forEach(layer => {
      const state = resolveLayerState(layer, states);
      layer.styleLayers.forEach(styleLayer => this.applyStyleLayerState(styleLayer, state));
    });
  }

  // Push one style layer's state onto whatever draws it. Through the style document here, because
  // that is where all but two of our previews live; a preview that paints itself - an Allmaps
  // warped map, a deck.gl overlay - has no paint property to set and overrides this instead.
  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    // A layer the style no longer holds is one a rebuild hasn't finished replacing
    if (!this.map.getLayer(styleLayer.id)) return;

    // An opacity of zero has to hide the layer outright, not just make it invisible:
    // queryRenderedFeatures skips layers set to `visibility: none` but still reports features
    // from a layer drawn at zero opacity, which would let a user click what they can't see.
    this.map.setLayoutProperty(styleLayer.id, 'visibility', isLayerDrawn(state) ? 'visible' : 'none');

    // A highlight is drawn for us by the server we asked; dimming it would make the answer
    // harder to read at exactly the moment the user asked for it
    if (!styleLayer.internal) this.applyOpacity(styleLayer, state.opacity);
  }

  // The style layers a rendered-feature query should consider. Always a subset of layerIds:
  // queryRenderedFeatures errors and returns nothing for the whole query if it names a layer the
  // style doesn't hold.
  get visibleLayerIds(): string[] {
    return this.previewLayers.flatMap(layer => {
      if (!isLayerDrawn(resolveLayerState(layer, this.layerState))) return [];
      return layer.styleLayers.filter(styleLayer => !styleLayer.internal).map(styleLayer => styleLayer.id);
    });
  }

  // Whether any of this preview is drawn. A server-drawn raster has no client-side features to
  // filter a query by, so ogm-map has to ask before offering to inspect one.
  get anyLayerVisible(): boolean {
    return this.previewLayers.some(layer => isLayerDrawn(resolveLayerState(layer, this.layerState)));
  }

  // Write the opacity a style layer carries. Only the property its type owns: MapLibre rejects a
  // paint property a layer type doesn't define, and fires an error on the map when it does.
  protected applyOpacity(styleLayer: PreviewStyleLayer, opacity: number) {
    switch (styleLayer.type) {
      case 'raster':
        this.map.setPaintProperty(styleLayer.id, 'raster-opacity', opacity);
        break;
      case 'fill':
        this.map.setPaintProperty(styleLayer.id, 'fill-opacity', opacity);
        break;
      case 'line':
        this.map.setPaintProperty(styleLayer.id, 'line-opacity', opacity);
        break;
      case 'circle':
        this.map.setPaintProperty(styleLayer.id, 'circle-opacity', opacity);
        this.map.setPaintProperty(styleLayer.id, 'circle-stroke-opacity', opacity);
        break;
      case 'symbol':
        this.map.setPaintProperty(styleLayer.id, 'text-opacity', opacity);
        break;
    }
  }

  protected findPreviewLayer(id: string): Layer | undefined {
    return this.previewLayers.find(layer => layer.id === id);
  }

  /**
   * What the record said this covers, answered on the spot: the bounding box the resource was built
   * with, and nothing that would have to be fetched to know.
   *
   * For the one caller that can't wait - a map is built before anything is drawn on it, and building
   * it already pointed at the record is what saves the reader a look at the whole world first; see
   * openingCamera. getBounds() below is the better answer and is what the camera settles on, but it
   * can be a round trip or two away, and a map cannot be built later than it is built.
   *
   * Undefined for a record that never said where it is, which leaves the map wherever it opens.
   */
  get declaredBounds(): maplibregl.LngLatBoundsLike | undefined {
    return this.resource.declaredBounds;
  }

  // Where the map should be pointed to see this preview. The resource usually knows - from the
  // record's bounding box, or from metadata it reads itself - so only a preview that learns its
  // extent while drawing, like a warped image, has anything to override here.
  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return await this.resource.getBounds();
  }

  // Create MapLibre sources for the preview
  protected abstract createSources(): Promise<AddSourceObject[]>;

  // Create MapLibre layers for the preview
  protected abstract createLayers(): Promise<AddLayerObject[]>;
}
