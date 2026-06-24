import { Component, Prop, State, Watch, Event, EventEmitter, h } from '@stencil/core';
import { MapGeoJSONFeature } from 'maplibre-gl';
import Autolinker from 'autolinker';

const LABEL_KEYS = ['name', 'title', 'label', 'id'] as const;

const getFeatureLabel = (feature: MapGeoJSONFeature): string | undefined => {
  const originalKeys = Object.keys(feature.properties || {});
  if (originalKeys.length === 0) return;
  const key = LABEL_KEYS.map(k => originalKeys.find(ok => ok.toLowerCase() === k)).find(Boolean);
  if (key) return feature.properties?.[key];
};

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
    const label = getFeatureLabel(feature);

    return (
      <table class="attribute-table">
        {multiple && label ? (
          <thead>
            <tr class="header">
              <td colSpan={2}>
                <div class="pagination">
                  <sl-icon-button name="arrow-left" label="Previous feature" disabled={this.currentIndex === 0} onClick={() => this.currentIndex--} />
                  {label && (
                    <div class="label">
                      <div>{label}</div>
                    </div>
                  )}
                  <div class="count">
                    {' '}
                    ({this.currentIndex + 1}/{this.features.length})
                  </div>
                  <sl-icon-button name="arrow-right" label="Next feature" disabled={this.currentIndex === this.features.length - 1} onClick={() => this.currentIndex++} />
                </div>
              </td>
            </tr>
          </thead>
        ) : (
          label && (
            <thead>
              <tr class="header">
                <td colSpan={2}>
                  <div class="label">
                    <div>{label}</div>
                  </div>
                </td>
              </tr>
            </thead>
          )
        )}
        <tbody>
          {Object.entries(feature.properties || {}).map(([key, value]) => (
            <tr key={key}>
              <td class="key">{key}</td>
              <td class="value" innerHTML={Autolinker.link(value.toString(), { hashtag: false, mention: false, phone: false })}></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
}
