import { Component, Prop, State, Watch, Event, EventEmitter, h, Host } from '@stencil/core';
import { MapGeoJSONFeature } from 'maplibre-gl';
import Autolinker from 'autolinker';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';
import '@awesome.me/webawesome/dist/components/skeleton/skeleton.js';

import { getFeatureTitle } from '../../lib/features';
import { describeSheet, sheetHasImage, sheetThumbnail, sheetWebsite } from '../../lib/openindexmap';
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
  // Whether the search for a picture has finished, so an index map sheet that turns out not to have
  // one falls through to its properties rather than sitting on an empty frame
  @State() private searched = false;
  // Whether the picture has finished downloading. Knowing its URL is not the same as having it, and
  // the download is the longer half of the wait for a sheet that carries a thumbUrl - so the
  // placeholder stays up until the picture can actually be seen.
  @State() private painted = false;
  // Set by the button in the header: the reader asked for the properties instead of the picture. Kept
  // across paging, so a reader comparing sheets doesn't have to ask again for every one of them, and
  // reset when a new click brings a new set of features.
  @State() private showProperties = false;

  // Which feature's thumbnail is wanted. Paging is faster than fetching a manifest, so this both
  // keeps a late answer from painting over a newer one and keeps the same feature from being asked
  // about twice when a new list of features resets the index to a zero it was already at.
  private wanted?: MapGeoJSONFeature;

  // Not awaited, and deliberately: whether there is a picture is known before it has arrived
  componentWillLoad() {
    this.loadThumbnail();
  }

  @Watch('features')
  onFeaturesChange() {
    this.currentIndex = 0;
    this.showProperties = false;
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
    this.painted = false;
    this.searched = !feature;
    if (!feature) return;

    const thumbnail = await sheetThumbnail(feature.properties, this.requestTransform);
    if (feature !== this.wanted) return;

    this.thumbnail = thumbnail;
    this.searched = true;
  }

  // Whether this sheet says it has a picture. Answered without waiting, so the popup opens on the
  // right one of the two rather than opening on the properties and swapping a moment later.
  private get expectsImage(): boolean {
    const feature = this.features[this.currentIndex];
    return this.kind === 'openindexmap' && !!feature && sheetHasImage(feature.properties);
  }

  // The picture is what's shown, unless the reader asked for the properties or the sheet turned out
  // not to have one after all
  private get showingImage(): boolean {
    if (this.showProperties || !this.expectsImage) return false;
    return !this.searched || !!this.thumbnail;
  }

  render() {
    if (this.features.length === 0) return null;

    const feature = this.features[this.currentIndex];

    return (
      <Host>
        {this.renderHeader(feature)}
        <div class="body">
          {this.showingImage ? this.renderImage(feature) : this.renderProperties(feature)}
          {this.renderSwap()}
        </div>
      </Host>
    );
  }

  // A row of its own across the top of the popup: what the feature is called and where it sits in a
  // stack of them. It gets the popup's full width, which is what keeps a long title from squeezing
  // the paging out of it.
  private renderHeader(feature: MapGeoJSONFeature) {
    const multiple = this.features.length > 1;
    const title = getFeatureTitle(feature);
    if (!multiple && !title) return;

    return (
      <div class="header">
        {multiple && (
          <wa-button class="page" size="xs" appearance="plain" disabled={this.currentIndex === 0} onClick={() => this.currentIndex--}>
            <wa-icon name="arrow-left" label="Previous feature" canvas="auto"></wa-icon>
          </wa-button>
        )}
        {/* Rendered even with nothing to say, so the controls stay at the ends of the row */}
        <div class="title">{title}</div>
        {multiple && (
          <div class="count">
            ({this.currentIndex + 1}/{this.features.length})
          </div>
        )}
        {multiple && (
          <wa-button class="page" size="xs" appearance="plain" disabled={this.currentIndex === this.features.length - 1} onClick={() => this.currentIndex++}>
            <wa-icon name="arrow-right" label="Next feature" canvas="auto"></wa-icon>
          </wa-button>
        )}
      </div>
    );
  }

  // Which of the sheet's two views to show, over the content rather than in the header: it is easier
  // to find in the corner of the thing it acts on, and out of the header the title has the middle of
  // the row to itself. Filled and outlined so it stays legible over whatever the picture happens to
  // be, the same way <ogm-image>'s controls are. The title is the tooltip; the icon's label is the
  // accessible name, which the button's own content takes precedence for.
  private renderSwap() {
    if (!this.thumbnail) return;
    const describe = this.showProperties ? 'Show the picture of this sheet' : 'Show this sheet’s details';

    return (
      <wa-button class="swap" size="xs" appearance="filled-outlined" pill title={describe} onClick={() => (this.showProperties = !this.showProperties)}>
        <wa-icon name={this.showProperties ? 'image' : 'card-list'} label={describe} canvas="auto"></wa-icon>
      </wa-button>
    );
  }

  // The sheet itself, which is what you want when deciding which sheet you're after. Linked to
  // wherever its Web link goes, since that is the click a picture invites. The frame it goes in is
  // the same size before and after it arrives, so the popup doesn't grow out from under the reader
  // while they're looking at it - see the .content rule.
  private renderImage(feature: MapGeoJSONFeature) {
    const image = <img class="thumbnail" src={this.thumbnail} alt="" onLoad={() => (this.painted = true)} onError={() => this.giveUpOnPicture()} />;
    const website = sheetWebsite(feature.properties);

    return (
      <div class="content">
        {this.thumbnail &&
          (website ? (
            <a class="thumbnail-link" href={website} target="_blank" rel="noreferrer" title="View this map">
              {image}
            </a>
          ) : (
            image
          ))}
        {/* Over the picture rather than beside it, so the frame is one size throughout */}
        {!this.painted && <wa-skeleton class="pending" effect="sheen"></wa-skeleton>}
      </div>
    );
  }

  // The sheet named a picture and the picture isn't there. Same end as a sheet that named none at
  // all: showingImage falls through to the properties, and the swap button goes with the thumbnail.
  private giveUpOnPicture() {
    this.thumbnail = undefined;
    this.painted = false;
    this.searched = true;
  }

  private renderProperties(feature: MapGeoJSONFeature) {
    return (
      <wa-scroller orientation="vertical">
        <table class="attribute-table">
          <tbody>{this.renderRows(feature)}</tbody>
        </table>
      </wa-scroller>
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
