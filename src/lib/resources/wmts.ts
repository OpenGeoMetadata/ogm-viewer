import RasterResource from './raster';

// Layers (potentially multiple) accessed via WMTS GetTile requests
// NOTE: in Aardvark, the reference URL is the GetCapabilities URL, not the tile URL
export default class WmtsResource extends RasterResource {
  // Memoized metadata via GetCapabilities request
  private metadata: Document;

  label() {
    return 'Web Map Tile Service (WMTS)';
  }

  // Fetch and memoize WMTS GetCapabilities XML document
  protected async getMetadata() {
    if (!this.metadata) {
      const resp = await fetch(this.url);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  async getRasterLayers() {
    const metadata = await this.getMetadata();
    const layers = Array.from(metadata.getElementsByTagName('Layer'));
    return layers.map(layer => {
      const id = layer.getElementsByTagName('Identifier')[0].textContent;
      return { id: id || '' };
    });
  }

  // WMTS has no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }
}
