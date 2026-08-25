import { Component, Event, EventEmitter, h, Host, Prop, State } from '@stencil/core';

import { COLOR_RAMPS, colormapSprite, rampGradient, type ColorRampName } from '../../lib/colormap';
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
  @Event() layerColorRampChange: EventEmitter<{ id: string; colorRamp: ColorRampName }>;
  @Event() allLayersVisibilityChange: EventEmitter<boolean>;

  // The sprite every ramp swatch draws its gradient from - see colormapSprite(). Loaded before the
  // first render rather than read synchronously, since decoding it needs no GPU device but does
  // need a moment; Stencil holds componentWillLoad's own promise open for exactly this. Left
  // undefined rather than thrown past if decoding fails for some reason, so a broken sprite costs
  // this panel its gradients rather than the whole thing.
  @State() private sprite: ImageData | undefined;

  async componentWillLoad() {
    try {
      this.sprite = await colormapSprite();
    } catch (error) {
      console.warn('Could not decode the color ramp sprite, so ramp swatches will show as plain labels:', error);
    }
  }

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

  private onColorRampInput(layer: LayerControl, event: Event) {
    this.layerColorRampChange.emit({ id: layer.id, colorRamp: (event.target as HTMLInputElement).value as ColorRampName });
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
                {layer.colorRamp && (
                  <div class="row">
                    <fieldset class="ramps" aria-label={`Color ramp for ${layer.title}`}>
                      {COLOR_RAMPS.map(({ key, label }) => (
                        <label class="swatch" key={key} title={label} style={this.sprite && { background: rampGradient(this.sprite, key) }}>
                          <input
                            type="radio"
                            name={`ramp-${layer.id}`}
                            value={key}
                            checked={layer.colorRamp === key}
                            aria-label={label}
                            onChange={event => this.onColorRampInput(layer, event)}
                          />
                        </label>
                      ))}
                    </fieldset>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Host>
    );
  }
}
