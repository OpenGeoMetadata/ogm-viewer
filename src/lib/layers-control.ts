import type { IControl, Map } from 'maplibre-gl';

// A button in the map's control stack that shows and hides the layer panel. It builds the same DOM
// MapLibre's own controls build, which is the whole point: the group chrome, the hover tint, the
// focus ring and the dark-mode inversion in ogm-map.css all already select these class names, so
// this button is styled by the rules that style its neighbours rather than by rules of its own.
export default class LayersControl implements IControl {
  private container: HTMLElement | undefined;
  private button: HTMLButtonElement | undefined;

  constructor(private onToggle: () => void) {}

  onAdd(_map: Map): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    this.button = document.createElement('button');
    this.button.className = 'maplibregl-ctrl-layers';
    this.button.type = 'button';
    this.button.addEventListener('click', () => this.onToggle());

    // MapLibre draws control icons as a background image on this span, so it carries no content of
    // its own and the button's name has to come from the label attributes
    const icon = document.createElement('span');
    icon.className = 'maplibregl-ctrl-icon';
    icon.setAttribute('aria-hidden', 'true');

    this.button.appendChild(icon);
    this.container.appendChild(this.button);
    this.setPressed(false);
    return this.container;
  }

  onRemove(_map: Map) {
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
  }

  // Whether the panel is currently showing. Shown as a background tint rather than MapLibre's own
  // convention of a blue glyph, because a colored icon under the dark-mode `filter: invert(1)` is
  // exactly what forced the globe-icon and focus-ring workarounds in ogm-map.css.
  setPressed(pressed: boolean) {
    if (!this.button) return;
    const label = pressed ? 'Hide layers' : 'Show layers';
    this.button.setAttribute('aria-pressed', String(pressed));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    this.button.classList.toggle('pressed', pressed);
  }

  // Hidden rather than removed from the map, so that an embedder toggling `hide-layer-controls` at
  // runtime gets the button back where it was: addControl appends, so removing and re-adding would
  // drop it to the bottom of the stack.
  setHidden(hidden: boolean) {
    if (this.container) this.container.hidden = hidden;
  }
}
