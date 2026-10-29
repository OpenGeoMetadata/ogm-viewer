import { Component, h, Host, Prop } from '@stencil/core';

import type { FieldDefinitions } from '../../lib/field-definitions';

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

              {field.definition && <dd>{field.definition}</dd>}
              {field.codedValues && <dd class="coded">{codedSummary(field.codedValues)}</dd>}
            </div>
          ))}
        </dl>
      </Host>
    );
  }
}

const codedSummary = (values: Map<string, string>): string => `${values.size} documented ${values.size === 1 ? 'value' : 'values'}`;
