import type Source from '../sources/source';

export default abstract class Previewer {
  protected source: Source;

  constructor(source: Source) {
    this.source = source;
  }

  abstract preview(): Promise<void>;
  abstract clearPreview(): void;
}
