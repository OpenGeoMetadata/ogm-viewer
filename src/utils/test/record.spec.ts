import { OgmRecord } from '../record';

describe('OgmRecord', () => {
  describe('getGeometry', () => {
    it('should return GeoJSON from locn_geometry', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        locn_geometry: 'POLYGON((19.08 70.09, 31.59 70.09, 31.59 59.45, 19.08 59.45, 19.08 70.09))',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toEqual({
        type: 'Polygon',
        coordinates: [
          [
            [19.08, 70.09],
            [31.59, 70.09],
            [31.59, 59.45],
            [19.08, 59.45],
            [19.08, 70.09],
          ],
        ],
      });
    });

    it('should return GeoJSON from dcat_bbox', () => {
      const record = new OgmRecord({
        id: '2',
        dct_title_s: 'Test Record with BBox',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dcat_bbox: 'ENVELOPE(-20,-15,-5,-1)',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toEqual({
        type: 'Polygon',
        coordinates: [
          [
            [-20, -1],
            [-15, -1],
            [-15, -5],
            [-20, -5],
            [-20, -1],
          ],
        ],
      });
    });
  });
});
