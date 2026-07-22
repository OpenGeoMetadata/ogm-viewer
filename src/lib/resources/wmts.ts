import RasterResource from './raster';

// Spec for a single layer that will generate a matching MapLibre source/layer
export type WmtsLayer = {
  id: string;
  title: string;
  tileUrls: string[];
};

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
    console.log('Fetching WMTS metadata for resource', this.id);
    if (!this.metadata) {
      const resp = await fetch(this.url);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  // Each layer will be tied to a source with multiple tile URLs
  async getLayers() {
    const metadata = await this.getMetadata();
    return Array.from(metadata.getElementsByTagName('Layer')).map(layer => {
      const style = layer.getElementsByTagName('Style')[0].textContent;
      const tileMatrixSet = layer.getElementsByTagName('TileMatrixSet')[0].textContent;

      // TODO bounds
      return {
        id: layer.getElementsByTagName('Identifier')[0].textContent,
        title: layer.getElementsByTagName('Title')[0].textContent,
        tileUrls: Array.from(layer.getElementsByTagName('ResourceURL'))
          .map(resourceUrl => resourceUrl.getAttribute('template'))
          .map(template => this.formatTileUrl(template ?? '', style, tileMatrixSet)),
      };
    });
  }

  // Rewrite the tile URL template to a MapLibre-compatible (XYZ-style) URL
  protected formatTileUrl(template: string, style: string, tileMatrixSet: string) {
    return template.replace('{TileMatrixSet}', tileMatrixSet)
      .replace('{Style}', style)
      .replace('{TileMatrix}', '{z}')
      .replace('{TileRow}', '{y}')
      .replace('{TileCol}', '{x}'); 
  }

  // We rewrite WMTS tile URLs to XYZ-style URLs, so the scheme is always 'xyz'
  getScheme() {
    return 'xyz' as const;
  }
}
