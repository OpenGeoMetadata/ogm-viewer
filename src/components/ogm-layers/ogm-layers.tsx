import { Component, Event, EventEmitter, h, Host, Prop } from '@stencil/core';

import type { LayerControlItem } from '../../lib/layers';

// The checkbox and range input here are deliberately native rather than <wa-switch>/<wa-slider>.
// Web Awesome's form controls are form-associated, and their base class reads ElementInternals,
// which the component test environment doesn't implement - constructing one throws and fails the
// whole run. Native inputs style identically from --wa-* tokens, are keyboard accessible without
// help, and let the opacity interaction actually be tested.
@Component({
  tag: 'ogm-layers',
  styleUrl: 'ogm-layers.css',
  shadow: true,
})
export class OgmLayers {
  @Prop() theme: 'light' | 'dark';
  @Prop() layers: LayerControlItem[] = [];

  @Event() layerVisibilityChange: EventEmitter<{ id: string; visible: boolean }>;
  @Event() layerOpacityChange: EventEmitter<{ id: string; opacity: number }>;
  @Event() allLayersVisibilityChange: EventEmitter<boolean>;

  // A single-layer record - nearly every record - is just its one row: there is nothing to summarize,
  // and the row's own title names the panel. Only a genuine list needs a count and a hide-all.
  private get summarized(): boolean {
    return this.layers.length > 1;
  }

  private get allVisible(): boolean {
    return this.layers.every(layer => layer.visible);
  }

  // MapLibre paints in the order layers were added, so the last one added is drawn on top. Reading
  // the list top-down should match reading the map top-down.
  private get rows(): LayerControlItem[] {
    return [...this.layers].reverse();
  }

  private onVisibilityInput(layer: LayerControlItem, event: Event) {
    this.layerVisibilityChange.emit({ id: layer.id, visible: (event.target as HTMLInputElement).checked });
  }

  // The slider speaks whole percentages because that's what a reader adjusts; everything below this
  // component works in 0-1, and this is the only place the two meet
  private onOpacityInput(layer: LayerControlItem, event: Event) {
    this.layerOpacityChange.emit({ id: layer.id, opacity: Number((event.target as HTMLInputElement).value) / 100 });
  }

  render() {
    // Nothing to show while a preview is loading, or when one failed: no chrome over an empty map
    if (!this.layers.length) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class="panel" role="group" aria-label="Layer controls">
          {this.summarized && (
            <div class="header">
              <span class="title">Layers ({this.layers.length})</span>
              <input
                class="visibility"
                type="checkbox"
                checked={this.allVisible}
                aria-label={this.allVisible ? 'Hide all layers' : 'Show all layers'}
                onChange={event => this.allLayersVisibilityChange.emit((event.target as HTMLInputElement).checked)}
              />
            </div>
          )}
          <ul class="layers">
            {this.rows.map(layer => (
              <li class="layer" key={layer.id}>
                <div class="row">
                  <input class="visibility" type="checkbox" checked={layer.visible} aria-label={layer.title} onChange={event => this.onVisibilityInput(layer, event)} />
                  <span class="title" title={layer.title}>
                    {layer.title}
                  </span>
                </div>
                <div class="row">
                  <input
                    class="opacity"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(layer.opacity * 100)}
                    aria-label={`Opacity of ${layer.title}`}
                    onInput={event => this.onOpacityInput(layer, event)}
                  />
                  <span class="percent">{Math.round(layer.opacity * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Host>
    );
  }
}
