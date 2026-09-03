import { describe, expect, it } from 'vitest';

import { annotationText, contentSearchRequestUrl, matchingEntities, pixelRegionFor, type ContentSearchAnnotation } from './content-search';

const result = (selector: { type: string; value: string }): ContentSearchAnnotation => ({
  'type': 'Annotation',
  'body': { type: 'TextualBody', value: 'Market St.' },
  'target': { source: 'https://example.org/canvas/1', selector },
  'myrdal:evidence': {
    matched_by: 'gazetteer_entity',
    entity_matches: [{ id: 'place:1', label: 'Market Street', outcome: 'confirmed' }],
  },
});

describe('IIIF content search', () => {
  it('builds a query without discarding endpoint parameters', () => {
    const url = new URL(contentSearchRequestUrl('https://example.org/search?target_source=canvas', 'Market Street'));

    expect(url.searchParams.get('target_source')).toBe('canvas');
    expect(url.searchParams.get('q')).toBe('Market Street');
  });

  it('reads text and optional Gazetteer evidence from a result', () => {
    const annotation = result({ type: 'FragmentSelector', value: 'xywh=10,20,100,30' });

    expect(annotationText(annotation)).toBe('Market St.');
    expect(matchingEntities(annotation)).toEqual([{ id: 'place:1', label: 'Market Street', outcome: 'confirmed' }]);
  });

  it('turns a media fragment into image-pixel bounds', () => {
    expect(pixelRegionFor(result({ type: 'FragmentSelector', value: 'xywh=pixel:10,20,100,30' }))).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 30,
    });
  });

  it('uses a polygon bounding box when the service returns an SVG selector', () => {
    expect(
      pixelRegionFor(
        result({
          type: 'SvgSelector',
          value: '<svg xmlns="http://www.w3.org/2000/svg"><polygon points="10,20 110,20 110,50 10,50"/></svg>',
        }),
      ),
    ).toEqual({ x: 10, y: 20, width: 100, height: 30 });
  });
});
