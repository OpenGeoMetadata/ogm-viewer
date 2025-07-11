import { Component, Host, Prop, State, h } from '@stencil/core';

import type { OgmRecord } from '../../utils/record';
import { OGM_FIELD_NAMES } from '../../utils/record';

type OgmMetadataField = keyof typeof OGM_FIELD_NAMES;
type OgmMetadataValue = OgmRecord[OgmMetadataField];

@Component({
  tag: 'ogm-metadata',
  styleUrl: 'ogm-metadata.css',
  shadow: true,
})
export class OgmMetadata {
  @Prop() record: OgmRecord;
  @Prop() fieldNames: string[];
  @State() filteredRecord: OgmRecord;

  // Render all fields in the provided partial record
  renderMetadata(record: Partial<OgmRecord>) {
    return Object.entries(record).map(([name, value]) => {
      return this.renderField(name as OgmMetadataField, value as OgmMetadataValue);
    });
  }

  // Render a single field with its value, using the field name mapping
  renderField(name: OgmMetadataField, value: OgmMetadataValue) {
    if (!value) return;
    return (
      <div class={`field ${name}`}>
        <dt>{OGM_FIELD_NAMES[name]}</dt>
        {this.renderFieldValue(value)}
      </div>
    );
  }

  // Render the value of a field, handling arrays and single values
  renderFieldValue(value: OgmMetadataValue) {
    if (Array.isArray(value)) return value.map(v => this.renderFieldValue(v));
    return <dd key={value.toString()}>{value}</dd>;
  }

  render() {
    // If no record is provided, do not render anything
    if (!this.record) return;

    // Filter the record to only include fields specified in fieldNames prop
    const availableFields = this.fieldNames.filter(field => field in this.record) as OgmMetadataField[];
    const record: Partial<OgmRecord> = availableFields.reduce((filteredRecord, field) => {
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
