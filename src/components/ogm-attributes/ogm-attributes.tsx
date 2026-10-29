import { Component, Prop, State, Watch, Event, EventEmitter, h, Host } from '@stencil/core';
import { MapGeoJSONFeature } from 'maplibre-gl';
import Autolinker from 'autolinker';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';
import '@awesome.me/webawesome/dist/components/skeleton/skeleton.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

import { fieldDefinitions, type FieldDefinition, type FieldDefinitions } from '../../lib/field-definitions';
import { getFeatureTitle } from '../../lib/features';
import { describeSheet, sheetHasImage, sheetThumbnail, sheetWebsite } from '../../lib/openindexmap';
import type { References } from '../../lib/references';
import type { RequestTransform } from '../../lib/request';
import type { ResourceKind } from '../../lib/resources/resource';

const autolink = (text: string) => Autolinker.link(text, { hashtag: false, mention: false, phone: false });

const anchorId = (key: string) => `definition-${key.replace(/[^\w-]/g, '-')}`;

type SheetTab = 'image' | 'attributes';

type TabShowEvent = Event & { detail: { name: string } };

@Component({
  tag: 'ogm-attributes',
  styleUrl: 'ogm-attributes.css',
  shadow: true,
})
export class OgmAttributes {
  @Prop() features: MapGeoJSONFeature[] = [];
  @Prop() kind?: ResourceKind;
  @Prop() requestTransform?: RequestTransform;
  @Prop() references?: References;
  @Event() featureSelected: EventEmitter<MapGeoJSONFeature>;
  @State() private currentIndex = 0;
  @State() private thumbnail?: string;
  @State() private searched = false;
  @State() private painted = false;
  // Keep the selected tab while paging; reset it for a new set of features.
  @State() private tab: SheetTab = 'image';
  @State() private definitions?: FieldDefinitions;

  // Ignore thumbnail responses for features the user has already paged past.
  private wanted?: MapGeoJSONFeature;

  componentWillLoad() {
    this.loadThumbnail();
    this.loadDefinitions();
  }

  @Watch('references')
  onReferencesChange() {
    this.loadDefinitions();
  }

  @Watch('features')
  onFeaturesChange() {
    this.currentIndex = 0;
    this.tab = 'image';
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

  private async loadDefinitions() {
    const references = this.references;
    if (!references) {
      this.definitions = undefined;
      return;
    }

    const definitions = await fieldDefinitions(references, this.requestTransform);
    if (references !== this.references) return;
    this.definitions = definitions;
  }

  private get expectsImage(): boolean {
    const feature = this.features[this.currentIndex];
    return this.kind === 'openindexmap' && !!feature && sheetHasImage(feature.properties);
  }

  private get hasPicture(): boolean {
    if (!this.expectsImage) return false;
    return !this.searched || !!this.thumbnail;
  }

  render() {
    if (this.features.length === 0) return null;

    const feature = this.features[this.currentIndex];
    const header = this.renderHeader(feature);

    return (
      <Host>
        {header}
        {this.hasPicture ? this.renderTabs(feature, !header) : this.renderProperties(feature)}
      </Host>
    );
  }

  private renderHeader(feature: MapGeoJSONFeature) {
    const multiple = this.features.length > 1;
    const title = getFeatureTitle(feature);

    return (
      <div class="header">
        {multiple && (
          <wa-button class="page" size="xs" appearance="plain" disabled={this.currentIndex === 0} onClick={() => this.currentIndex--}>
            <wa-icon name="arrow-left" label="Previous feature" canvas="auto"></wa-icon>
          </wa-button>
        )}
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

  // Set the active panel explicitly to avoid a flash before the tab group initializes.
  private renderTabs(feature: MapGeoJSONFeature, topmost: boolean) {
    return (
      <wa-tab-group class={{ topmost }} active={this.tab} on-wa-tab-show={(event: TabShowEvent) => (this.tab = event.detail.name as SheetTab)}>
        <wa-tab panel="image">Image</wa-tab>
        <wa-tab panel="attributes">Attributes</wa-tab>

        <wa-tab-panel name="image" active={this.tab === 'image'}>
          {this.renderImage(feature)}
        </wa-tab-panel>
        <wa-tab-panel name="attributes" active={this.tab === 'attributes'}>
          {this.renderProperties(feature)}
        </wa-tab-panel>
      </wa-tab-group>
    );
  }

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

        {!this.painted && <wa-skeleton class="pending" effect="sheen"></wa-skeleton>}
      </div>
    );
  }

  private giveUpOnPicture() {
    this.thumbnail = undefined;
    this.painted = false;
    this.searched = true;
  }

  private renderProperties(feature: MapGeoJSONFeature) {
    // Keep tooltip text outside the table so copying a cell does not include its definition.
    return [
      <wa-scroller orientation="vertical">
        <table class="attribute-table">
          <tbody>{this.renderRows(feature)}</tbody>
        </table>
      </wa-scroller>,
      ...this.documentedFields(feature).map(({ anchor, definition }) => (
        <wa-tooltip key={anchor} for={anchor}>
          {definition}
        </wa-tooltip>
      )),
    ];
  }

  private documentedFields(feature: MapGeoJSONFeature): { anchor: string; definition: string }[] {
    if (this.kind === 'openindexmap' || !this.definitions) return [];

    return Object.keys(feature.properties || {})
      .map(key => ({ anchor: anchorId(key), definition: this.definitions?.get(key.toLowerCase())?.definition }))
      .filter((field): field is { anchor: string; definition: string } => !!field.definition);
  }

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

    return Object.entries(feature.properties || {}).map(([key, value]) => {
      const definition = this.definitions?.get(key.toLowerCase());

      return (
        <tr key={key}>
          <td class="key">{this.renderKey(key, definition)}</td>
          {this.renderValue(value, definition)}
        </tr>
      );
    });
  }

  private renderKey(key: string, definition?: FieldDefinition) {
    if (!definition?.definition) return key;

    return (
      <span id={anchorId(key)} class="defined" tabindex="0">
        {key}
      </span>
    );
  }

  // Render metadata labels as text; only raw values go through the HTML autolinker.
  private renderValue(value: unknown, definition?: FieldDefinition) {
    const raw = value?.toString() ?? '';
    const decoded = definition?.codedValues?.get(raw.trim());
    if (!decoded) return <td class="value" innerHTML={autolink(raw)}></td>;

    return (
      <td class="value">
        <span class="decoded">{decoded}</span> <span class="code">({raw})</span>
      </td>
    );
  }
}
