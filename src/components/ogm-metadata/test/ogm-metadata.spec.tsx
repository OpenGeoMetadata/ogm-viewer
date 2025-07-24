import { h } from '@stencil/core';
import { newSpecPage } from '@stencil/core/testing';
import { OgmMetadata } from '../ogm-metadata';
import { OgmRecord } from '../../../utils/record';

describe('ogm-metadata', () => {
  describe('with no record', () => {
    it('does not render anything', async () => {
      const record = undefined;

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
        <ogm-metadata>
          <mock:shadow-root>
          </mock:shadow-root>
        </ogm-metadata>
      `);
    });
  });

  describe('with a record and no fieldNames', () => {
    it('renders all provided fields', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [
          'This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.',
          'This dataset was developed/compiled for use in the San Francisco Bay Area Upland Habitat Goals Project, a Project used to identify a Conservation Lands Network (CLN) for biodiversity preservation to inform conservation investments and lasting cooperative conservation partnerships.',
        ],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
        <ogm-metadata>
          <mock:shadow-root>
            <dl class="record-details">
              <div class="field id">
                <dt>ID</dt>
                <dd>stanford-ff359cr8805</dd>
              </div>
              <div class="field title">
                <dt>Title</dt>
                <dd>Coho Salmon Watersheds: San Francisco Bay Area, California, 2011</dd>
              </div>
              <div class="field description">
                <dt>Description</dt>
                <dd>This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.</dd>
                <dd>This dataset was developed/compiled for use in the San Francisco Bay Area Upland Habitat Goals Project, a Project used to identify a Conservation Lands Network (CLN) for biodiversity preservation to inform conservation investments and lasting cooperative conservation partnerships.</dd>
              </div>
              <div class="field resourceType">
                <dt>Resource Type</dt>
                <dd>Polygon data</dd>
              </div>
              <div class="field resourceClass">
                <dt>Resource Class</dt>
                <dd>Datasets</dd>
              </div>
              <div class="field accessRights">
                <dt>Access Rights</dt>
                <dd>Public</dd>
              </div>
              <div class="field mdVersion">
                <dt>Metadata Version</dt>
                <dd>Aardvark</dd>
              </div>
            </dl>
          </mock:shadow-root>
        </ogm-metadata>
      `);
    });
  });

  describe('with a record and fieldNames', () => {
    it('renders only the specified fields', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [
          'This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.',
        ],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const fieldNames = ['id', 'title', 'resourceType'];

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record} fieldNames={fieldNames}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
        <ogm-metadata>
          <mock:shadow-root>
            <dl class="record-details">
              <div class="field id">
                <dt>ID</dt>
                <dd>stanford-ff359cr8805</dd>
              </div>
              <div class="field title">
                <dt>Title</dt>
                <dd>Coho Salmon Watersheds: San Francisco Bay Area, California, 2011</dd>
              </div>
              <div class="field resourceType">
                <dt>Resource Type</dt>
                <dd>Polygon data</dd>
              </div>
            </dl>
          </mock:shadow-root>
        </ogm-metadata>
      `);
    });
  });

  describe('with a record and fieldNames', () => {
    it('renders only the specified fields', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [
          'This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.',
        ],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const fieldNames = ['id', 'title', 'resourceType'];

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record} fieldNames={fieldNames}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
        <ogm-metadata>
          <mock:shadow-root>
            <dl class="record-details">
              <div class="field id">
                <dt>ID</dt>
                <dd>stanford-ff359cr8805</dd>
              </div>
              <div class="field title">
                <dt>Title</dt>
                <dd>Coho Salmon Watersheds: San Francisco Bay Area, California, 2011</dd>
              </div>
              <div class="field resourceType">
                <dt>Resource Type</dt>
                <dd>Polygon data</dd>
              </div>
            </dl>
          </mock:shadow-root>
        </ogm-metadata>
      `);
    });
  });

  describe('with single download URL', () => {
    it('renders a single download link', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [
          'This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.',
          'This dataset was developed/compiled for use in the San Francisco Bay Area Upland Habitat Goals Project, a Project used to identify a Conservation Lands Network (CLN) for biodiversity preservation to inform conservation investments and lasting cooperative conservation partnerships.',
        ],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': 'https://stacks.stanford.edu/object/vx572wx7854',
        }),
      });
      const fieldNames = ['references'];

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record} fieldNames={fieldNames}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
      <ogm-metadata>
        <mock:shadow-root>
          <dl class="record-details">
            <div class="field references">
              <dt>Download</dt>
              <dd>
                <a href="https://stacks.stanford.edu/object/vx572wx7854">Original file</a>
              </dd>
            </div>
          </dl>
        </mock:shadow-root>
      </ogm-metadata>
    `);
    });
  });

  describe('with multiple download URL', () => {
    it('renders a single download link', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [
          'This polygon shapefile depicts the Coho Salmon Priority Restoration Areas in the nine county San Francisco Bay Area Region, California, as defined by the National Oceanic and Atmospheric Administration (NOAA), National Marine Fisheries Service (NMFS), Southwest Region, North-Central California Coast Recovery Team.',
          'This dataset was developed/compiled for use in the San Francisco Bay Area Upland Habitat Goals Project, a Project used to identify a Conservation Lands Network (CLN) for biodiversity preservation to inform conservation investments and lasting cooperative conservation partnerships.',
        ],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': [
            { url: 'https://stacks.stanford.edu/object/vx572wx7854', label: 'Zipped object1' },
            { url: 'https://stacks.stanford.edu/object/cz128vq0535', label: 'Zipped object2' },
          ],
        }),
      });
      const fieldNames = ['references'];

      const page = await newSpecPage({
        components: [OgmMetadata],
        template: () => <ogm-metadata record={record} fieldNames={fieldNames}></ogm-metadata>,
      });

      expect(page.root).toEqualHtml(`
      <ogm-metadata>
        <mock:shadow-root>
          <dl class="record-details">
            <div class="field references">
              <dt>Downloads</dt>
              <dd>
                <a href="https://stacks.stanford.edu/object/vx572wx7854">Zipped object1</a>
              </dd>
              <dd>
                <a href="https://stacks.stanford.edu/object/cz128vq0535">Zipped object2</a>
              </dd>
            </div>
          </dl>
        </mock:shadow-root>
      </ogm-metadata>
    `);
    });
  });
});
