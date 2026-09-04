import { Component, h, Host, Prop } from '@stencil/core';

import type { FieldDefinitions } from '../../lib/field-definitions';

// Shows field definitions for a record, coming from metadata documents
@Component({
  tag: 'ogm-fields',
  styleUrl: 'ogm-fields.css',
  shadow: true,
})
export class OgmFields {
  @Prop() theme: 'light' | 'dark';
  @Prop() definitions?: FieldDefinitions;

  render() {
    if (!this.definitions?.size) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <dl class="field-definitions">
          {Array.from(this.definitions.values()).map(field => (
            <div class="field" key={field.name}>
              <dt>{field.name}</dt>
              {/* A field can be listed with no definition of its own - the metadata named it and
                  said nothing more - and is still worth showing as one of the data's columns. */}
              {field.definition && <dd>{field.definition}</dd>}
              {field.codedValues && <dd class="coded">{codedSummary(field.codedValues)}</dd>}
            </div>
          ))}
        </dl>
      </Host>
    );
  }
}

// If we know there are X number of coded values, list how many.
const codedSummary = (values: Map<string, string>): string => `${values.size} documented ${values.size === 1 ? 'value' : 'values'}`;
