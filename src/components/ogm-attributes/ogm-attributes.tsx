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

// Ties a field's name to the tooltip that explains it. Field names come out of somebody's shapefile,
// so anything that isn't allowed in an id is replaced rather than trusted.
const anchorId = (key: string) => `definition-${key.replace(/[^\w-]/g, '-')}`;

// The two views a sheet has, which are also the names of their tabs
type SheetTab = 'image' | 'attributes';

// What wa-tab-group announces a switch with. It is a plain Event carrying a detail rather than a
// CustomEvent, so its shape has to be named here.
type TabShowEvent = Event & { detail: { name: string } };

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
  // Applied to the requests this component makes of its own - an index map sheet's IIIF manifest,
  // read for a thumbnail, and the record's field definitions. See Resource.requestTransform.
  @Prop() requestTransform?: RequestTransform;
  // The record's references, read for whichever metadata document describes its fields. Handed the
  // whole set rather than one URL because which document to read is the lib module's decision, not
  // this component's - see fieldDefinitions. Absent for a previewer built by hand from a resource.
  @Prop() references?: References;
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
  // Which of a sheet's two views the reader is looking at. Kept across paging, so a reader comparing
  // sheets doesn't have to ask for the same one again on every one of them, and reset when a new
  // click brings a new set of features.
  @State() private tab: SheetTab = 'image';
  // What the record's own metadata says its fields hold, once it has been read - and undefined for
  // the majority of records, which either point at no such document or point at one no browser can
  // read. A table that never gets this shows exactly what it always did.
  @State() private definitions?: FieldDefinitions;

  // Which feature's thumbnail is wanted. Paging is faster than fetching a manifest, so this both
  // keeps a late answer from painting over a newer one and keeps the same feature from being asked
  // about twice when a new list of features resets the index to a zero it was already at.
  private wanted?: MapGeoJSONFeature;

  // Neither is awaited, and deliberately: whether there is a picture is known before it has arrived,
  // and the field definitions are an improvement to a table that reads fine without them
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

  // Cheap to call more than once: fieldDefinitions holds one read per document for the life of the
  // page, so the sidebar's own copy of this question and ours share a single fetch.
  private async loadDefinitions() {
    const references = this.references;
    if (!references) {
      this.definitions = undefined;
      return;
    }

    const definitions = await fieldDefinitions(references, this.requestTransform);
    // A new record's references may have arrived while this one was being read
    if (references !== this.references) return;
    this.definitions = definitions;
  }

  // Whether this sheet says it has a picture. Answered without waiting, so the popup opens on the
  // right one of the two rather than opening on the properties and swapping a moment later.
  private get expectsImage(): boolean {
    const feature = this.features[this.currentIndex];
    return this.kind === 'openindexmap' && !!feature && sheetHasImage(feature.properties);
  }

  // Whether there is a picture to offer: one that has arrived, or one the sheet named that hasn't
  // yet. Answered without waiting where it can be, so the tab strip is there from the first paint
  // rather than arriving with the manifest and moving the popup under the reader.
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

  // A row of its own across the top of the popup: what the feature is called and where it sits in a
  // stack of them. It gets the popup's full width, which is what keeps a long title from squeezing
  // the paging out of it.
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

  // The sheet's picture and its properties, a tab each. There is only ever room in the popup for one
  // of them, and a tab strip is how this viewer already says that - <ogm-previews> gives a record's
  // previews the same treatment. Only drawn when there is a picture to offer: a strip of one tab
  // over the properties is a label, not a choice.
  //
  // wa-tab-group tracks the showing tab itself and would happily be left to it, but then the choice
  // would also survive a new click, which is a fresh question. Driving it from our own state instead
  // keeps both that reset and the deliberate carrying-over across paging in one place.
  private renderTabs(feature: MapGeoJSONFeature, topmost: boolean) {
    return (
      <wa-tab-group class={{ topmost }} active={this.tab} on-wa-tab-show={(event: TabShowEvent) => (this.tab = event.detail.name as SheetTab)}>
        <wa-tab panel="image">Image</wa-tab>
        <wa-tab panel="attributes">Attributes</wa-tab>
        {/* Also set here, not just on the group: the group settles which panel is showing once it is
            on screen, and until then this is what decides. */}
        <wa-tab-panel name="image" active={this.tab === 'image'}>
          {this.renderImage(feature)}
        </wa-tab-panel>
        <wa-tab-panel name="attributes" active={this.tab === 'attributes'}>
          {this.renderProperties(feature)}
        </wa-tab-panel>
      </wa-tab-group>
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
  // all: hasPicture goes false, so the tab strip goes and the properties have the popup.
  private giveUpOnPicture() {
    this.thumbnail = undefined;
    this.painted = false;
    this.searched = true;
  }

  private renderProperties(feature: MapGeoJSONFeature) {
    // The tooltips sit outside the table rather than in the cells they explain. A wa-tooltip holds
    // its text as a child, and a child of the cell is part of the cell: it would land in the middle
    // of anything that reads the table as text, a selection copied out of it included. It finds its
    // anchor by id from anywhere in this shadow root.
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

  // The fields of this feature the record's metadata has something to say about, paired with the id
  // that ties each one to its tooltip. Empty for an index map sheet, whose properties are named by
  // the OpenIndexMaps spec rather than by a metadata document.
  private documentedFields(feature: MapGeoJSONFeature): { anchor: string; definition: string }[] {
    if (this.kind === 'openindexmap' || !this.definitions) return [];

    return Object.keys(feature.properties || {})
      .map(key => ({ anchor: anchorId(key), definition: this.definitions?.get(key.toLowerCase())?.definition }))
      .filter((field): field is { anchor: string; definition: string } => !!field.definition);
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

    return Object.entries(feature.properties || {}).map(([key, value]) => {
      // Looked up lower-cased: a GetFeatureInfo response says 'routetype' where the FGDC describing
      // it says 'ROUTETYPE'. See src/lib/field-definitions.ts.
      const definition = this.definitions?.get(key.toLowerCase());

      return (
        <tr key={key}>
          <td class="key">{this.renderKey(key, definition)}</td>
          {this.renderValue(value, definition)}
        </tr>
      );
    });
  }

  // The field's name, and where the metadata explains it, the name itself is the affordance for
  // that explanation - dotted underline, no icon. In a dataset that documents itself nearly every
  // field has a definition, so an icon per row would mark the rule rather than the exception. The
  // tooltip that reads this id is rendered by renderProperties, in the same pairing <ogm-menubar>
  // uses; tabindex is what makes it reachable without a mouse.
  private renderKey(key: string, definition?: FieldDefinition) {
    if (!definition?.definition) return key;

    return (
      <span id={anchorId(key)} class="defined" tabindex="0">
        {key}
      </span>
    );
  }

  // A value the metadata can decode reads as what it means, with the code it was written as kept
  // beside it in case the reader is looking for that. Anything else keeps the autolinked text it
  // has always had - and a decoded value deliberately doesn't go through autolink, since that sets
  // innerHTML and this text comes out of somebody else's XML.
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
