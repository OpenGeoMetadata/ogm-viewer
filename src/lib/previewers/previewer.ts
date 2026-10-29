import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import type { RequestTransform } from '../request';

export type PreviewRenderer = 'map' | 'image';

export default abstract class Previewer {
  abstract readonly renderer: PreviewRenderer;

  readonly inspectable: boolean = true;

  protected resource: Resource;

  constructor(resource: Resource) {
    this.resource = resource;
  }

  get requestTransform(): RequestTransform | undefined {
    return this.resource.requestTransform;
  }

  get kind(): ResourceKind {
    return this.resource.kind;
  }

  get resourceId(): string {
    return this.resource.id;
  }

  // Include resource kind because multiple previews of one record share its record ID.
  get previewId(): string {
    return `${this.resource.id}-${this.kind}-${this.renderer}`;
  }

  label(): string {
    return this.resource.label();
  }

  get url(): string {
    return this.resource.url;
  }

  abstract preview(): Promise<void>;
  abstract clearPreview(): Promise<void>;
}
