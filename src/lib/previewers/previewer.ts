import type Resource from '../resources/resource';

// Base class for rendering a resource into a preview
export default abstract class Previewer {
  protected resource: Resource;

  constructor(resource: Resource) {
    this.resource = resource;
  }

  abstract preview(): Promise<void>;
  abstract clearPreview(): void;
}
