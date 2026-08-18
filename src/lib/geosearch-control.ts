import type { IControl, Map, MapEventType } from 'maplibre-gl';

// What the control says it will do, in each of its two modes. Given rather than baked in because
// GeoBlacklight already runs both strings through Rails I18n before handing them to the Leaflet
// control this one replaces, and a translated reader shouldn't lose them in the swap.
export type GeosearchLabels = {
  searchHere: string;
  searchOnMove: string;
};

// Whether the control searches every view the reader comes to rest in, or only the one they ask about
export type GeosearchMode = 'auto' | 'manual';

// How long to leave after the reader stops moving the map before searching where they stopped.
// GeoBlacklight's own wait. MapLibre already folds a gesture and its inertia into a single moveend, so
// this isn't there to coalesce one gesture: it's for the reader who pans twice, holds an arrow key, or
// turns a wheel, none of whom meant to ask about anywhere they passed through on the way.
const SEARCH_DELAY = 800;

// The camera settling under the reader's own hand, as against one something else pointed. MapLibre
// threads the DOM event behind a gesture through to whatever the camera fires, and leaves it off every
// camera it moves itself, so this is the whole of how the two are told apart - see handleCameraEnd.
//
// `moveend` is the one that matters and would almost do alone: unlike Leaflet's dragend, which is why
// GeoBlacklight debounces at all, it fires once per interaction with inertia already spent. The other
// two are each here for a case it misses:
//
// - `dragend`, because a container that resizes mid-drag takes the drag's moveend with it. The resize
//   calls Camera#stop, which reaches HandlerManager#stop(false), and with no end animation allowed
//   that fires dragend and no moveend at all.
// - `boxzoomend`, because a box zoom's camera is a fitScreenCoordinates call the handler returns
//   without any event data, so its moveend arrives untagged and reads as one of ours. The boxzoomend
//   just before it is tagged, and is the only notice of a shift-drag we get.
//
// Arming from any of them costs nothing, because the bounds are read when the wait ends rather than
// when it starts: whichever arrives first, what gets searched is where the map came to rest.
const CAMERA_END_EVENTS = ['moveend', 'dragend', 'boxzoomend'] as const;

/**
 * A control that asks for the area on screen to be searched: either whenever the reader stops moving
 * the map, or only when they press the button. Modelled on GeoBlacklight's Leaflet geosearch control.
 *
 * Like the other controls here it emits nothing itself - it calls what it was built with, and the
 * component that put it on the map is the one that owns an event.
 */
export default class GeosearchControl implements IControl {
  private container: HTMLElement | undefined;
  private label: HTMLLabelElement | undefined;
  private checkbox: HTMLInputElement | undefined;
  private text: HTMLSpanElement | undefined;
  private button: HTMLButtonElement | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private onSearch: () => void,
    private labels: GeosearchLabels,
    private mode: GeosearchMode = 'auto',
  ) {}

  onAdd(map: Map): HTMLElement {
    this.container = document.createElement('div');
    // Deliberately not maplibregl-ctrl-group. That class carries MapLibre's white pill and the metrics
    // for a 29px square icon button, and it's the selector <ogm-map> inverts wholesale in dark mode.
    // This is a line of text, so it's drawn on the same surface tokens as the attribution and follows
    // the mode without being inverted - which is what a checkbox's accent and a focus ring both need.
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-geosearch';

    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    this.checkbox.addEventListener('change', this.handleToggle);

    // The words are the checkbox's accessible name, so what it's called is always what it says. An
    // aria-label here would be a second copy to fall out of step with - and the reason LayersControl
    // needs one is that its button is a background image with no text to name it.
    this.text = document.createElement('span');

    this.label = document.createElement('label');
    this.label.className = 'on-move';
    this.label.append(this.checkbox, this.text);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'search-here';
    this.button.addEventListener('click', this.handleSearchHere);

    this.container.append(this.label, this.button);
    this.applyLabels();
    this.setMode(this.mode);

    for (const event of CAMERA_END_EVENTS) map.on(event, this.handleCameraEnd);
    return this.container;
  }

  onRemove(map: Map) {
    // Before the container goes, so a wait already under way can't come due against a map that has
    // been taken down - or, through the callback, against a component that has stopped rendering.
    this.cancelSearch();
    for (const event of CAMERA_END_EVENTS) map.off(event, this.handleCameraEnd);

    this.container?.remove();
    this.container = undefined;
    this.label = undefined;
    this.checkbox = undefined;
    this.text = undefined;
    this.button = undefined;
  }

  // Retexted where it stands rather than rebuilt, so a change of wording doesn't take the mode, the
  // pending wait, or the reader's place in the tab order with it.
  setLabels(labels: GeosearchLabels) {
    this.labels = labels;
    this.applyLabels();
  }

  private applyLabels() {
    if (!this.text || !this.button) return;
    this.text.textContent = this.labels.searchOnMove;
    this.button.textContent = this.labels.searchHere;
  }

  /**
   * Show whichever of the two the given mode calls for, and answer to it from here on.
   *
   * Both stay on the map with one hidden, rather than one being built and the other thrown away: the
   * reader may have arrived by keyboard, and focus has to have somewhere to land when what held it
   * goes. Moving focus is also what announces the change - whichever control they land on names what
   * pressing it will do - so there is nothing left for a live region to say.
   */
  private setMode(mode: GeosearchMode) {
    this.mode = mode;
    // A view the reader has stopped asking about. Without this, unticking within the wait still
    // searches, and pressing the button searches twice.
    this.cancelSearch();
    if (!this.label || !this.checkbox || !this.button) return;

    // Whether what is about to be hidden is what the reader is on. Asked of the root rather than the
    // document, because from out here document.activeElement is the shadow host.
    const root = this.container?.getRootNode() as Document | ShadowRoot | undefined;
    const focused = !!root?.activeElement && !!this.container?.contains(root.activeElement);

    const auto = mode === 'auto';
    this.checkbox.checked = auto;
    this.label.hidden = !auto;
    this.button.hidden = auto;

    if (focused) (auto ? this.checkbox : this.button).focus();
  }

  // Unticking is all the checkbox does; ticking it again is the button's job, once it has searched.
  // Either way the mode follows what the box now reads.
  private handleToggle = () => {
    this.setMode(this.checkbox?.checked ? 'auto' : 'manual');
  };

  // Asked for outright, so it happens now rather than after the wait a moved map gets - and then the
  // control goes back to searching every view, which is what the reader asking at all suggests they
  // wanted. GeoBlacklight gets this from the full page reload its own search does.
  private handleSearchHere = () => {
    this.onSearch();
    this.setMode('auto');
  };

  private handleCameraEnd = (event: MapEventType[(typeof CAMERA_END_EVENTS)[number]]) => {
    if (!event.originalEvent) return;
    if (this.mode !== 'auto') return;
    this.scheduleSearch();
  };

  // Trailing edge, unlike the throttle in maps.ts: reallocating a drawing buffer is worth doing on the
  // way as well as at the end, but a search is a question somebody else has to answer, and the only
  // view worth asking about is the one the reader stopped in.
  private scheduleSearch() {
    this.cancelSearch();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onSearch();
    }, SEARCH_DELAY);
  }

  private cancelSearch() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
