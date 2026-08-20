import { AttributionControl as MapLibreAttributionControl, type Map } from 'maplibre-gl';

/**
 * MapLibre's attribution, opening as the "i" in the corner rather than as the panel behind it.
 *
 * Compact names the shape the credit can collapse to, not the shape it starts in: MapLibre opens the
 * panel as soon as there is something to credit, and only shrinks it to the "i" once the reader drags
 * the map. On a map the size of a locator that is most of one corner spent on a line nobody came to
 * read. The credit itself isn't optional - the basemaps are CARTO's over OpenStreetMap data and both
 * require it - so the pill stays and starts small instead.
 *
 * `maplibregl-compact` is the class the collapsed pill is drawn from, and MapLibre only ever adds it
 * in the same breath as `maplibregl-compact-show`, the class that opens the panel, and only when the
 * container isn't already carrying it. So claiming it here is the whole mechanism: what MapLibre
 * finds afterwards is exactly the state its own first pass would have left, and its toggle, its
 * collapse-on-drag and its own resize pass all still work.
 *
 * The other way round - taking the show class off once it appears - has no good moment to happen in.
 * Not as the control is added, because the container is `maplibregl-attrib-empty` then, and that is
 * the very class blocking the branch that would open it. Not on style.load either: CARTO's style
 * names no attribution of its own, only a source to fetch, so the credit line lands with that fetch
 * some way after the style is up. And anything late enough to catch it has to be careful not to fire
 * twice, because our own observer calls map.resize() whenever the container changes and a resize runs
 * the same code - which would shut a panel the reader had just opened.
 */
export default class AttributionControl extends MapLibreAttributionControl {
  // After MapLibre's own onAdd rather than before it, because the container is what that hands back
  onAdd(map: Map): HTMLElement {
    const container = super.onAdd(map);
    container.classList.add('maplibregl-compact');
    return container;
  }
}
