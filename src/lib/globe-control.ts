import { GlobeControl as MapLibreGlobeControl, type Map } from 'maplibre-gl';

export default class GlobeControl extends MapLibreGlobeControl {
  private container: HTMLElement | undefined;

  onAdd(map: Map): HTMLElement {
    this.container = super.onAdd(map);
    return this.container;
  }

  // Hide the control in place so showing it again preserves its position in the stack.
  setHidden(hidden: boolean) {
    if (this.container) this.container.hidden = hidden;
  }
}
