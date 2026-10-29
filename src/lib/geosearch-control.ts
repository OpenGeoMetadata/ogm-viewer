import type { IControl, Map } from 'maplibre-gl';

export default class GeosearchControl implements IControl {
  private container: HTMLElement | undefined;

  constructor(private text: string) {}

  onAdd(map: Map): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-geosearch';
    this.container.textContent = this.text;

    map.on('boxzoomstart', this.hide);
    map.on('boxzoomend', this.show);
    map.on('boxzoomcancel', this.show);

    // Restore help text on blur because MapLibre cancels the drag without firing boxzoomcancel.
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
