import { Component, Event, EventEmitter, h, Host, Prop, State } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/details/details.js';

import { colormapSprite, formatValue, rampGradient } from '../../lib/colormap';
import { imageLegends, type LegendEntry, type LegendImage } from '../../lib/legend';
import { rampedLayers, type LayerControl } from '../../lib/layers';

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
  @Prop() zoom?: number;
  @Prop() open: boolean = true;

  @Event() legendToggle: EventEmitter<boolean>;

  @State() private folded: boolean = false;

  // The sprite every entry's gradient bar is drawn from. See ogm-layers.tsx's own sprite field for
  // why this is loaded in componentWillLoad rather than read synchronously, and why a decode
  // failure is caught rather than left to fail the component: a legend with no gradients still
  // labels its ends, which is most of what a legend is for.
  @State() private sprite: ImageData | undefined;

  // Legend pictures that wouldn't load, by URL
  @State() private brokenImages: ReadonlySet<string> = new Set();

  async componentWillLoad() {
    this.folded = !this.open;

    try {
      this.sprite = await colormapSprite();
    } catch (error) {
      console.warn('Could not decode the color ramp sprite, so the legend will show no gradient:', error);
    }
  }

  private giveUpOnImage(image: LegendImage) {
    console.warn(`Could not load the legend image ${image.url}, so the legend will go without it.`);
    this.brokenImages = new Set([...this.brokenImages, image.url]);
  }

  // Web Awesome's show and hide events bubble, so one from something inside the legend would
  // otherwise read as the legend itself opening or closing
  private ownEvent(event: Event): boolean {
    return event.target === event.currentTarget;
  }

  private handleShow(event: Event) {
    if (!this.ownEvent(event)) return;
    this.folded = false;
    this.legendToggle.emit(true);
  }

  private handleHide(event: Event) {
    if (this.ownEvent(event)) this.legendToggle.emit(false);
  }

  private handleAfterHide(event: Event) {
    if (this.ownEvent(event)) this.folded = true;
  }

  render() {
    const ramps = rampedLayers(this.layers);
    const images = imageLegends(this.layers, this.zoom, this.brokenImages);
    if (!this.entries.length && !ramps.length && !images.length) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class={{ 'panel': true, 'has-images': images.length > 0, 'folded': this.folded }} role="group" aria-label="Legend">
          <wa-details
            summary="Legend"
            appearance="plain"
            open={this.open}
            on-wa-show={(event: Event) => this.handleShow(event)}
            on-wa-hide={(event: Event) => this.handleHide(event)}
            on-wa-after-hide={(event: Event) => this.handleAfterHide(event)}
          >
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
            {images.map(({ layer, image }) => (
              <div class="entry image-entry" key={layer.id}>
                <div class="picture">
                  <img
                    loading="lazy"
                    decoding="async"
                    src={image.url}
                    width={image.width}
                    height={image.height}
                    alt={`Legend for ${layer.title}`}
                    onError={() => this.giveUpOnImage(image)}
                  />
                </div>
              </div>
            ))}
          </wa-details>
        </div>
      </Host>
    );
  }
}
