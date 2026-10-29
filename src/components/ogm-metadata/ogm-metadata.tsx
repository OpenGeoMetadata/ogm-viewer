// @ts-ignore
import { Component, Host, Prop, State, h, Fragment } from '@stencil/core';

import type OgmRecord from '../../lib/record';
import { OGM_FIELD_NAMES } from '../../lib/record';
import type { LabelledLinks } from '../../lib/references';

type OgmMetadataField = keyof typeof OGM_FIELD_NAMES;
type OgmMetadataValue = OgmRecord[OgmMetadataField];

const DEFAULT_FIELD_NAMES = Object.keys(OGM_FIELD_NAMES) as OgmMetadataField[];

@Component({
  tag: 'ogm-metadata',
  styleUrl: 'ogm-metadata.css',
  shadow: true,
})
export class OgmMetadata {
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';
  @Prop() fieldNames: string[];
  @State() filteredRecord: OgmRecord;

  get availableFields(): OgmMetadataField[] {
    if (!this.fieldNames) return DEFAULT_FIELD_NAMES;
    return this.fieldNames.filter(field => field in this.record) as OgmMetadataField[];
  }

  private renderMetadata(record: Partial<OgmRecord>) {
    return Object.entries(record).map(([name, value]) => {
      return this.renderField(name as OgmMetadataField, value as OgmMetadataValue);
    });
  }

  private renderField(name: OgmMetadataField, value: OgmMetadataValue) {
    if (!value) return;
    if (Array.isArray(value) && !value.length) return;

    if (name === 'references') return this.renderReferences();

    return (
      <div class={`field ${name}`}>
        <dt>{OGM_FIELD_NAMES[name]}</dt>
        {this.renderFieldValue(value)}
      </div>
    );
  }

  private renderFieldValue(value: OgmMetadataValue) {
    return [value].flat().map(v => <dd>{v?.toString()}</dd>);
  }

  private renderReferences() {
    const downloadLinks = this.record.downloadLinks;
    const metadataLinks = this.record.references.metadataLinks;
    if (!downloadLinks.length && !metadataLinks.length) return;

    return (
      <div class="references">
        {this.renderDownloadLinks(downloadLinks)}
        {this.renderMetadataLinks(metadataLinks)}
      </div>
    );
  }

  private renderDownloadLinks(links: LabelledLinks) {
    if (!links.length) return;

    return (
      <div class="field downloads">
        <dt>Downloads</dt>
        {links.map(({ url, label }) => (
          <dd>
            <a href={url}>{label}</a>
          </dd>
        ))}
      </div>
    );
  }

  private renderMetadataLinks(links: LabelledLinks) {
    if (!links.length) return;

    return (
      <div class="field metadata">
        <dt>Metadata</dt>
        {links.map(({ url, label }) => (
          <dd>
            <a href={url}>{label}</a>
          </dd>
        ))}
      </div>
    );
  }

  render() {
    if (!this.record) return;

    const record = Object.fromEntries(this.availableFields.map(field => [field, this.record[field]])) as Partial<OgmRecord>;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <dl class="record-details">{this.renderMetadata(record)}</dl>
      </Host>
    );
  }
}
