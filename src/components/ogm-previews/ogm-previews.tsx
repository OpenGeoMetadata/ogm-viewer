import { Component, h, Prop, State, Watch, Host } from '@stencil/core';
import type OgmRecord from '../../lib/record';
import type Resource from '../../lib/resources/resource';

import CogResource from '../../lib/resources/cog';
import GeoJsonResource from '../../lib/resources/geojson';
import OpenIndexMapResource from '../../lib/resources/openindexmap';
import PMTilesResource from '../../lib/resources/pmtiles';
import TileJsonResource from '../../lib/resources/tilejson';
import TmsResource from '../../lib/resources/tms';
import WmsResource from '../../lib/resources/wms';
import WmtsResource from '../../lib/resources/wmts';
import XyzResource from '../../lib/resources/xyz';
import IIIFResource from '../../lib/resources/iiif';
import IIIFManifestResource from '../../lib/resources/iiif-manifest';

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
  @State() resources: Resource[] = [];

  // @Watch only fires on changes; handle the initial load here
  componentWillLoad() {
    if (this.record) this.getSources(this.record);
  }

  // Given a record, get all of the valid sources that can be used to preview it on a map
  @Watch('record')
  protected getSources(record: OgmRecord) {
    while (this.resources.length) this.resources.pop();
    const recordBounds = record.getBounds();

    if (record.references.iiifImageUrl) this.resources.push(new IIIFResource(record.id, record.references.iiifImageUrl, recordBounds));
    if (record.references.iiifManifestUrl) this.resources.push(new IIIFManifestResource(record.id, record.references.iiifManifestUrl, recordBounds));
    if (record.references.pmtilesUrl) this.resources.push(new PMTilesResource(record.id, record.references.pmtilesUrl, recordBounds));
    if (record.references.tilejsonUrl) this.resources.push(new TileJsonResource(record.id, record.references.tilejsonUrl, recordBounds));
    if (record.references.indexMapUrl) this.resources.push(new OpenIndexMapResource(record.id, record.references.indexMapUrl, recordBounds));
    if (record.references.geojsonUrl) this.resources.push(new GeoJsonResource(record.id, record.references.geojsonUrl, recordBounds));
    if (record.references.cogUrl) this.resources.push(new CogResource(record.id, record.references.cogUrl, recordBounds));
    if (record.references.tmsUrl) this.resources.push(new TmsResource(record.id, record.references.tmsUrl, recordBounds));
    if (record.references.xyzUrl) this.resources.push(new XyzResource(record.id, record.references.xyzUrl, recordBounds));
    if (record.references.wmtsUrl && record.wxsIdentifier)
      this.resources.push(new WmtsResource(record.id, record.references.wmtsUrl, { layerIds: [record.wxsIdentifier] }, recordBounds));
    if (record.references.wmsUrl && record.wxsIdentifier)
      this.resources.push(new WmsResource(record.id, record.references.wmsUrl, { layerIds: [record.wxsIdentifier] }, recordBounds));
  }

  // Render as tabs for switching between sources
  render() {
    if (!this.record || !this.resources.length) return;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <wa-tab-group>
          {this.resources.map((resource, idx) => (
            <wa-tab key={idx} panel={`${resource.constructor.name}-${resource.id}-${idx}`}>
              {resource.label()}
            </wa-tab>
          ))}
          {this.resources.map((resource, idx) => (
            <wa-tab-panel key={idx} name={`${resource.constructor.name}-${resource.id}-${idx}`} active={idx === 0}>
              <ogm-preview theme={this.theme} previewResource={resource} preview-opacity={this.previewOpacity} sidebar-padding={this.sidebarPadding}></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
