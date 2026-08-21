import type { IControl, Map } from 'maplibre-gl';

/**
 * A line of text over the map saying how to search it: hold shift and drag a box.
 *
 * Saying so is all it does. The gesture itself is MapLibre's own BoxZoomHandler, and the component
 * that put this on the map is the one holding the callback behind it - see <ogm-overview>. A control
 * rather than something rendered into a shadow root, because MapLibre's control stack is what sets a
 * corner aside and keeps the inset from the edge.
 *
 * The words are given rather than baked in, because GeoBlacklight already runs the strings for the
 * Leaflet control this one replaces through Rails I18n, and a translated reader shouldn't lose them
 * in the swap.
 *
 * It gets out of the way while a box is being drawn: it is the only thing of ours sitting over the
 * drawing surface, and the gesture it describes is the one thing that draws across it.
 */
export default class GeosearchControl implements IControl {
  private container: HTMLElement | undefined;

  constructor(private text: string) {}

  onAdd(map: Map): HTMLElement {
    this.container = document.createElement('div');
    // Deliberately not maplibregl-ctrl-group. That class carries MapLibre's white pill and the metrics
    // for a 29px square icon button, and it's the selector the dark-mode rules invert wholesale. This
    // is a line of text, so it's drawn on the same surface tokens as the attribution and follows the
    // mode without being inverted. .maplibregl-ctrl on its own still gives the float and the 10px
    // inset from the corner.
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-geosearch';
    this.container.textContent = this.text;

    map.on('boxzoomstart', this.hide);
    map.on('boxzoomend', this.show);
    map.on('boxzoomcancel', this.show);

    // A gesture the reader walked away from. MapLibre calls every handler off when the window loses
    // focus - alt-tab partway through a drag and the rectangle goes - but it does that by resetting
    // the handler, which fires neither of the two events above. Left to those alone, coming back to
    // the tab would mean coming back to a map with no help text on it, and nothing short of another
    // whole drag would bring it back.
    window.addEventListener('blur', this.show);

    return this.container;
  }

  onRemove(map: Map) {
    map.off('boxzoomstart', this.hide);
    map.off('boxzoomend', this.show);
    map.off('boxzoomcancel', this.show);
    window.removeEventListener('blur', this.show);

    this.container?.remove();
    this.container = undefined;
  }

  // Retexted where it stands rather than rebuilt, so a change of wording doesn't drop the control to
  // the bottom of its corner or blank it out partway through a reader's gesture.
  setText(text: string) {
    this.text = text;
    if (this.container) this.container.textContent = text;
  }

  private hide = () => {
    if (this.container) this.container.hidden = true;
  };

  private show = () => {
    if (this.container) this.container.hidden = false;
  };
}
