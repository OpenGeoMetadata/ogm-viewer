import { Component, Prop, State, Watch, Event, EventEmitter, h, Host } from '@stencil/core';
import { MapGeoJSONFeature } from 'maplibre-gl';
import Autolinker from 'autolinker';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';

import { getFeatureTitle } from '../../lib/features';
import { describeSheet, sheetThumbnail, sheetWebsite } from '../../lib/openindexmap';
import type { RequestTransform } from '../../lib/request';
import type { ResourceKind } from '../../lib/resources/resource';

const autolink = (text: string) => Autolinker.link(text, { hashtag: false, mention: false, phone: false });

@Component({
  tag: 'ogm-attributes',
  styleUrl: 'ogm-attributes.css',
  shadow: true,
})
export class OgmAttributes {
  @Prop() features: MapGeoJSONFeature[] = [];
  // What kind of data these features came from, so the kinds we can describe better than a table of
  // raw keys get that treatment. See Previewer.kind.
  @Prop() kind?: ResourceKind;
  // Applied to the one request this component makes of its own - an index map sheet's IIIF manifest,
  // read for a thumbnail. See Resource.requestTransform.
  @Prop() requestTransform?: RequestTransform;
  @Event() featureSelected: EventEmitter<MapGeoJSONFeature>;
  @State() private currentIndex = 0;
  @State() private thumbnail?: string;

  // Which feature's thumbnail is wanted. Paging is faster than fetching a manifest, so this both
  // keeps a late answer from painting over a newer one and keeps the same feature from being asked
  // about twice when a new list of features resets the index to a zero it was already at.
  private wanted?: MapGeoJSONFeature;

  // Not awaited, and deliberately: the table is worth showing before the picture has arrived
  componentWillLoad() {
    this.loadThumbnail();
  }

  @Watch('features')
  onFeaturesChange() {
    this.currentIndex = 0;
    this.loadThumbnail();
  }

  @Watch('currentIndex')
  onCurrentIndexChange() {
    const feature = this.features[this.currentIndex];
    if (feature) this.featureSelected.emit(feature);
    this.loadThumbnail();
  }

  private async loadThumbnail() {
    const feature = this.kind === 'openindexmap' ? this.features[this.currentIndex] : undefined;
    if (feature === this.wanted) return;

    this.wanted = feature;
    this.thumbnail = undefined;
    if (!feature) return;

    const thumbnail = await sheetThumbnail(feature.properties, this.requestTransform);
    if (feature === this.wanted) this.thumbnail = thumbnail;
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
      <Host>
        {this.renderThumbnail(feature)}
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
            <tbody>{this.renderRows(feature)}</tbody>
          </table>
        </wa-scroller>
      </Host>
    );
  }

  // A picture of the sheet, beside the properties rather than above them - see the stylesheet for why
  // that matters. Linked to wherever the sheet's own Web link goes, which is the click a thumbnail
  // invites.
  private renderThumbnail(feature: MapGeoJSONFeature) {
    if (!this.thumbnail) return;

    const image = <img class="thumbnail" src={this.thumbnail} alt="" />;
    const website = sheetWebsite(feature.properties);

    return website ? (
      <a class="thumbnail-link" href={website} target="_blank" rel="noreferrer" title="View this map">
        {image}
      </a>
    ) : (
      image
    );
  }

  // An index map's sheets carry the OpenIndexMaps spec's own properties, which have real names and,
  // for a few of them, somewhere to go. Anything else gets its keys and values as they came, which is
  // all a GetFeatureInfo response or a plain GeoJSON layer gives us to work with.
  private renderRows(feature: MapGeoJSONFeature) {
    if (this.kind === 'openindexmap') {
      return describeSheet(feature.properties).map(({ key, label, value, href }) => (
        <tr key={key}>
          <td class="key">{label}</td>
          {href ? (
            <td class="value">
              <a href={href} target="_blank" rel="noreferrer">
                {value}
              </a>
            </td>
          ) : (
            <td class="value" innerHTML={autolink(value)}></td>
          )}
        </tr>
      ));
    }

    return Object.entries(feature.properties || {}).map(([key, value]) => (
      <tr key={key}>
        <td class="key">{key}</td>
        <td class="value" innerHTML={autolink(value?.toString() ?? '')}></td>
      </tr>
    ));
  }
}
