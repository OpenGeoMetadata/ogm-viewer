import type { IControl, Map } from 'maplibre-gl';

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

  setPressed(pressed: boolean) {
    if (!this.button) return;
    const label = pressed ? 'Hide layers' : 'Show layers';
    this.button.setAttribute('aria-pressed', String(pressed));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    this.button.classList.toggle('pressed', pressed);
  }

  // Hide the control in place so showing it again preserves its position in the stack.
  setHidden(hidden: boolean) {
    if (this.container) this.container.hidden = hidden;
  }
}
