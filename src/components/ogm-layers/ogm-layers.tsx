import { Component, Event, EventEmitter, h, Host, Prop } from '@stencil/core';

import type { LayerControl } from '../../lib/layers';

// Panel for controlling visibility and opacity of MapLibre layers.
// Uses native HTML elements because they're easier to style and test.
@Component({
  tag: 'ogm-layers',
  styleUrl: 'ogm-layers.css',
  shadow: true,
})
export class OgmLayers {
  @Prop() theme: 'light' | 'dark';
  @Prop() layers: LayerControl[] = [];

  @Event() layerVisibilityChange: EventEmitter<{ id: string; visible: boolean }>;
  @Event() layerOpacityChange: EventEmitter<{ id: string; opacity: number }>;
  @Event() allLayersVisibilityChange: EventEmitter<boolean>;

  // Render a summary with its own checkbox, for multi-layered objects
  private get summarized(): boolean {
    return this.layers.length > 1;
  }

  private get allVisible(): boolean {
    return this.layers.every(layer => layer.visible);
  }

  // MapLibre paints in the order layers were added; last is on top
  private get rows(): LayerControl[] {
    return [...this.layers].reverse();
  }

  private onVisibilityInput(layer: LayerControl, event: Event) {
    this.layerVisibilityChange.emit({ id: layer.id, visible: (event.target as HTMLInputElement).checked });
  }

  private onOpacityInput(layer: LayerControl, event: Event) {
    this.layerOpacityChange.emit({ id: layer.id, opacity: Number((event.target as HTMLInputElement).value) / 100 });
  }

  render() {
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
