import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import type { RequestTransform } from '../request';

// Which component draws a preview. A string rather than a class, so ogm-preview can route without
// an instanceof: a class test only holds when both sides came from the same copy of the module.
export type PreviewRenderer = 'map' | 'image';

// One preview of one resource. A resource can offer more than one - a georeferenced scan is both
// an image to page through and a layer on a map - so this, not the resource, is what a tab is.
export default abstract class Previewer {
  // The component that draws this preview
  abstract readonly renderer: PreviewRenderer;

  protected resource: Resource;

  constructor(resource: Resource) {
    this.resource = resource;
  }

  // The resource's own request transform, if it has one. Exposed here so the component that
  // draws this preview can apply it to requests the resource doesn't make itself - MapLibre's own
  // tile fetches, once ogm-map attaches this previewer to a map.
  get requestTransform(): RequestTransform | undefined {
    return this.resource.requestTransform;
  }

  // What kind of data this preview draws. Exposed for a component that can describe some kinds
  // better than the rest - ogm-attributes renders an index map's sheets by the OpenIndexMaps spec
  // rather than as a table of raw keys. A string, for the same reason ResourceKind is one.
  get kind(): ResourceKind {
    return this.resource.kind;
  }

  // Identifies the tab and the panel that show this preview. Every resource of one record carries
  // the record's own id, so it takes the kind to tell them apart, and the renderer to tell two
  // previews of one resource apart. Stable under minification, unlike constructor.name. Two
  // previews of one resource drawn by the same component must override this.
  get previewId(): string {
    return `${this.resource.id}-${this.kind}-${this.renderer}`;
  }

  // What the tab that selects this preview is called. A second preview of the same resource
  // overrides this, since two tabs reading 'IIIF Manifest' would tell the user nothing.
  label(): string {
    return this.resource.label();
  }

  // The remote source this preview draws from. Reported alongside the label when a load fails,
  // which is the only reason anything outside a previewer needs to know about its resource.
  get url(): string {
    return this.resource.url;
  }

  // Put this preview in front of the user, and take it back down. What that means is the
  // subclass's business - style layers on a map, images in a viewer - but every preview does
  // both, and the component that draws it does neither.
  abstract preview(): Promise<void>;
  abstract clearPreview(): Promise<void>;
}
