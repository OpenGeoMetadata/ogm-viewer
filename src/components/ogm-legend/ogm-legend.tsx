import { Component, h, Host, Prop, State } from '@stencil/core';

import { colormapSprite, formatValue, rampGradient } from '../../lib/colormap';
import type { LegendEntry } from '../../lib/legend';
import { rampedLayers, type LayerControl } from '../../lib/layers';

// Reads a color ramp's ends for whichever drawn layers have one - a single-band COG of floats or
// signed integers, drawn through src/lib/previewers/cog-pipeline.ts. Kept off the layers panel and
// on the map instead: <ogm-layers> is unmounted while closed, and closing it is not asking to stop
// being able to read the map, only to stop editing it. Native HTML elements, matching ogm-layers'
// own reasoning for using them - easier to style and test than a Web Awesome component would be.
//
// <ogm-map> only mounts this when rampedLayers(this.layerControls) is non-empty - see its render()
// - rather than mounting it unconditionally and relying on the render() below to return null. Both
// would look right; only one of them is. A custom element that's always in the tree, with a
// component that has its own async componentWillLoad, was found - in this one component tree,
// under test - to delay a *different* component's own async lifecycle for reasons under Stencil's
// hood rather than any logic of this component's own. Not mounting it when there's nothing to show
// avoids the question rather than answering it.
@Component({
  tag: 'ogm-legend',
  styleUrl: 'ogm-legend.css',
  shadow: true,
})
export class OgmLegend {
  @Prop() theme: 'light' | 'dark';
  // Every layer control the panel would show, not a filtered list handed in from outside: which of
  // them are rampable, and which of those are actually drawn right now, is this component's own
  // question to answer, the same way ogm-layers decides for itself which row gets a ramp picker.
  @Prop() layers: LayerControl[] = [];
  // Discrete, named colors supplied by a previewer whose colors carry meaning of their own. Kept as
  // data rather than inferred here so this presentation component need not know what an index map is
  // or where its active theme colors came from.
  @Prop() entries: LegendEntry[] = [];

  // The sprite every entry's gradient bar is drawn from. See ogm-layers.tsx's own sprite field for
  // why this is loaded in componentWillLoad rather than read synchronously, and why a decode
  // failure is caught rather than left to fail the component: a legend with no gradients still
  // labels its ends, which is most of what a legend is for.
  @State() private sprite: ImageData | undefined;

  async componentWillLoad() {
    try {
      this.sprite = await colormapSprite();
    } catch (error) {
      console.warn('Could not decode the color ramp sprite, so the legend will show no gradient:', error);
    }
  }

  render() {
    const ramps = rampedLayers(this.layers);
    if (!this.entries.length && !ramps.length) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class="panel" role="group" aria-label="Legend">
          {this.entries.length > 0 && (
            <div class="swatches">
              {this.entries.map(entry => (
                <div class="swatch-entry" key={entry.label}>
                  <span class="swatch" style={{ backgroundColor: entry.color }} aria-hidden="true"></span>
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          )}
          {ramps.map(layer => {
            // Checked in `ramps` above; asserted here rather than re-checked, since this is the
            // one place their absence would otherwise be a type error rather than a filtered row.
            const [min, max] = layer.colorRampRange!;
            const step = max - min;

            return (
              <div class="entry ramp-entry" key={layer.id}>
                <span class="title" title={layer.title}>
                  {layer.title}
                </span>
                <div class="bar" style={this.sprite && { background: rampGradient(this.sprite, layer.colorRamp!) }}></div>
                <div class="labels">
                  <span class="min">{formatValue(min, step)}</span>
                  <span class="max">{formatValue(max, step)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Host>
    );
  }
}
