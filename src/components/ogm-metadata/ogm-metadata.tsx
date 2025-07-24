// @ts-ignore
import { Component, Host, Prop, State, h, Fragment } from '@stencil/core';

import type { OgmRecord } from '../../utils/record';
import { OGM_FIELD_NAMES } from '../../utils/record';
import type { LabelledLinks } from '../../utils/references';

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
  @Prop() fieldNames: string[];
  @State() filteredRecord: OgmRecord;

  // Fields in the provided record that match the fieldNames prop, if provided
  // Otherwise, use all fields in the record that match our schema
  get availableFields(): OgmMetadataField[] {
    if (!this.fieldNames) return DEFAULT_FIELD_NAMES;
    return this.fieldNames.filter(field => field in this.record) as OgmMetadataField[];
  }

  // Render all fields in the provided partial record
  private renderMetadata(record: Partial<OgmRecord>) {
    return Object.entries(record).map(([name, value]) => {
      return this.renderField(name as OgmMetadataField, value as OgmMetadataValue);
    });
  }

  // Render a single field with its value, using the field name mapping
  private renderField(name: OgmMetadataField, value: OgmMetadataValue) {
    if (!value) return;
    if (name === 'references') return this.renderReferences();

    return (
      <div class={`field ${name}`}>
        <dt>{OGM_FIELD_NAMES[name]}</dt>
        {this.renderFieldValue(value)}
      </div>
    );
  }

  // Render the value of a field, handling arrays and single values
  private renderFieldValue(value: OgmMetadataValue) {
    if (Array.isArray(value)) return value.map(v => this.renderFieldValue(v));
    return <dd>{value}</dd>;
  }

  // References is a special field with multiple parts
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

  // Render download links from the references
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

  // Render metadata links from the references
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
    // If no record is provided, do not render anything
    if (!this.record) return;

    // Filter the record to only include available fields
    const record: Partial<OgmRecord> = this.availableFields.reduce((filteredRecord, field) => {
      filteredRecord[field] = this.record[field];
      return filteredRecord;
    }, {});

    // Render the metadata fields
    return (
      <Host>
        <dl class="record-details">{this.renderMetadata(record)}</dl>
      </Host>
    );
  }
}
