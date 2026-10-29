import { AttributionControl as MapLibreAttributionControl, type Map } from 'maplibre-gl';

// Claim the compact class before attribution arrives so MapLibre leaves the panel collapsed.
export default class AttributionControl extends MapLibreAttributionControl {
  onAdd(map: Map): HTMLElement {
    const container = super.onAdd(map);
    container.classList.add('maplibregl-compact');
    return container;
  }
}
