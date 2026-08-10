import { GlobeControl as MapLibreGlobeControl, type Map } from 'maplibre-gl';

// MapLibre's globe button, with the ability to take itself off the map. A preview that can only be
// drawn flat has nothing to offer it: pressing it would put the map into a projection that preview
// is wrong in, or can't be drawn in at all. See MapPreviewer.projection.
export default class GlobeControl extends MapLibreGlobeControl {
  private container: HTMLElement | undefined;

  // The button, its icon, its click handler, and the map bindings that keep the two in step are all
  // MapLibre's own; this only holds on to what they were built in.
  onAdd(map: Map): HTMLElement {
    this.container = super.onAdd(map);
    return this.container;
  }

  // Hidden rather than removed from the map, for the same reason as LayersControl: addControl
  // appends, so removing and re-adding would drop the button to the bottom of the stack. Which
  // preview is showing can change at any time, and the controls shouldn't shuffle when it does.
  setHidden(hidden: boolean) {
    if (this.container) this.container.hidden = hidden;
  }
}
