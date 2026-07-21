import { Component, h, Prop, State, Watch, Host } from '@stencil/core';

import type OgmRecord from '../../lib/record';
import type Source from '../../lib/sources/source';

import CogSource from '../../lib/sources/cog';
import GeoJSONSource from '../../lib/sources/geojson';
import OpenIndexMapSource from '../../lib/sources/openindexmap';
import PMTilesSource from '../../lib/sources/pmtiles';
import TileJSONSource from '../../lib/sources/tilejson';
import TMSSource from '../../lib/sources/tms';
import WmsSource from '../../lib/sources/wms';
import XYZSource from '../../lib/sources/xyz';
import IIIFSource from '../../lib/sources/iiif';
import IIIFManifestSource from '../../lib/sources/iiif-manifest';

@Component({
  tag: 'ogm-previews',
  styleUrl: 'ogm-previews.css',
  shadow: true,
})
export class OgmPreviews {
  @Prop() theme: 'light' | 'dark';
  @Prop() record: OgmRecord;
  @Prop() previewOpacity: number;
  @Prop() sidebarPadding: number;
  @State() sources: Source[] = [];

  // @Watch only fires on changes; handle the initial load here
  componentWillLoad() {
    if (this.record) this.getSources(this.record);
  }

  // Given a record, get all of the valid sources that can be used to preview it on a map
  @Watch('record')
  protected getSources(record: OgmRecord) {
    while (this.sources.length) this.sources.pop();
    const recordBounds = record.getBounds();

    if (record.references.iiifImageUrl) this.sources.push(new IIIFSource(record.id, record.references.iiifImageUrl, recordBounds));
    if (record.references.iiifManifestUrl) this.sources.push(new IIIFManifestSource(record.id, record.references.iiifManifestUrl, recordBounds));
    if (record.references.pmtilesUrl) this.sources.push(new PMTilesSource(record.id, record.references.pmtilesUrl, recordBounds));
    if (record.references.tilejsonUrl) this.sources.push(new TileJSONSource(record.id, record.references.tilejsonUrl, recordBounds));
    if (record.references.indexMapUrl) this.sources.push(new OpenIndexMapSource(record.id, record.references.indexMapUrl, recordBounds));
    if (record.references.geojsonUrl) this.sources.push(new GeoJSONSource(record.id, record.references.geojsonUrl, recordBounds));
    if (record.references.cogUrl) this.sources.push(new CogSource(record.id, record.references.cogUrl, recordBounds));
    if (record.references.tmsUrl) this.sources.push(new TMSSource(record.id, record.references.tmsUrl, recordBounds));
    if (record.references.xyzUrl) this.sources.push(new XYZSource(record.id, record.references.xyzUrl, recordBounds));
    if (record.references.wmsUrl && record.wxsIdentifier) this.sources.push(new WmsSource(record.id, record.references.wmsUrl, { layerIds: [record.wxsIdentifier] }, recordBounds));
  }

  // Render as tabs for switching between sources
  render() {
    if (!this.record || !this.sources.length) return;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <wa-tab-group>
          {this.sources.map((source, idx) => (
            <wa-tab key={idx} panel={`${source.constructor.name}-${source.id}-${idx}`}>
              {source.label()}
            </wa-tab>
          ))}
          {this.sources.map((source, idx) => (
            <wa-tab-panel key={idx} name={`${source.constructor.name}-${source.id}-${idx}`} active={idx === 0}>
              <ogm-preview theme={this.theme} source={source} preview-opacity={this.previewOpacity} sidebar-padding={this.sidebarPadding}></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
