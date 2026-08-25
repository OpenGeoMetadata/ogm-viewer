import { Component, h, Host, Prop, State } from '@stencil/core';

import { colormapSprite, formatValue, rampGradient } from '../../lib/colormap';
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
    const entries = rampedLayers(this.layers);
    if (!entries.length) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class="panel" role="group" aria-label="Legend">
          {entries.map(layer => {
            // Checked in `entries` above; asserted here rather than re-checked, since this is the
            // one place their absence would otherwise be a type error rather than a filtered row.
            const [min, max] = layer.colorRampRange!;
            const step = max - min;

            return (
              <div class="entry" key={layer.id}>
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
