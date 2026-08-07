import { Component, Prop, State, Watch, Event, EventEmitter, h } from '@stencil/core';
import { MapGeoJSONFeature } from 'maplibre-gl';
import Autolinker from 'autolinker';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';

import { getFeatureTitle } from '../../lib/features';

@Component({
  tag: 'ogm-attributes',
  styleUrl: 'ogm-attributes.css',
  shadow: true,
})
export class OgmAttributes {
  @Prop() features: MapGeoJSONFeature[] = [];
  @Event() featureSelected: EventEmitter<MapGeoJSONFeature>;
  @State() private currentIndex = 0;

  @Watch('features')
  onFeaturesChange() {
    this.currentIndex = 0;
  }

  @Watch('currentIndex')
  onCurrentIndexChange() {
    const feature = this.features[this.currentIndex];
    if (feature) this.featureSelected.emit(feature);
  }

  render() {
    if (this.features.length === 0) return null;

    const feature = this.features[this.currentIndex];
    const multiple = this.features.length > 1;
    const title = getFeatureTitle(feature);
    const titleEl = title && (
      <div class="title">
        <div>{title}</div>
      </div>
    );

    return (
      <wa-scroller orientation="vertical">
        <table class="attribute-table">
          {(multiple || title) && (
            <thead>
              <tr class="header">
                <td colSpan={2}>
                  {multiple ? (
                    <div class="pagination">
                      <wa-button size="xs" appearance="plain" disabled={this.currentIndex === 0} onClick={() => this.currentIndex--}>
                        <wa-icon name="arrow-left" label="Previous feature" canvas="auto"></wa-icon>
                      </wa-button>
                      {titleEl}
                      <div class="count">
                        ({this.currentIndex + 1}/{this.features.length})
                      </div>
                      <wa-button size="xs" appearance="plain" disabled={this.currentIndex === this.features.length - 1} onClick={() => this.currentIndex++}>
                        <wa-icon name="arrow-right" label="Next feature" canvas="auto"></wa-icon>
                      </wa-button>
                    </div>
                  ) : (
                    titleEl
                  )}
                </td>
              </tr>
            </thead>
          )}
          <tbody>
            {Object.entries(feature.properties || {}).map(([key, value]) => (
              <tr key={key}>
                <td class="key">{key}</td>
                <td class="value" innerHTML={Autolinker.link(value?.toString() ?? '', { hashtag: false, mention: false, phone: false })}></td>
              </tr>
            ))}
          </tbody>
        </table>
      </wa-scroller>
    );
  }
}
