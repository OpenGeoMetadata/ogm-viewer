import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { findGeoreferenceAnnotation, isGeoreferenceAnnotation } from './georeference';
import type { RequestTransform } from '../request';

// The georeference annotation itself, as Allmaps writes one: the context and motivation the
// extension specifies, and a FeatureCollection of ground control points as the body.
const georeferenceAnnotation = {
  'id': 'https://annotations.allmaps.org/maps/4d2db0ceb5314230',
  'type': 'Annotation',
  '@context': ['http://iiif.io/api/extension/georef/1/context.json', 'http://iiif.io/api/presentation/3/context.json'],
  'motivation': 'georeferencing',
  'body': { type: 'FeatureCollection', features: [] },
};

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body));

describe('isGeoreferenceAnnotation', () => {
  it('recognizes the motivation the extension specifies', () => {
    expect(isGeoreferenceAnnotation({ motivation: 'georeferencing' })).toBe(true);
  });

  it('recognizes the motivation among several', () => {
    expect(isGeoreferenceAnnotation({ motivation: ['painting', 'georeferencing'] })).toBe(true);
  });

  // The extension is published under https but the annotations Allmaps writes name it with http
  it.each(['http://iiif.io/api/extension/georef/1/context.json', 'https://iiif.io/api/extension/georef/1/context.json'])('recognizes the %s context', context => {
    expect(isGeoreferenceAnnotation({ '@context': context })).toBe(true);
  });

  it('recognizes the context among several', () => {
    expect(isGeoreferenceAnnotation(georeferenceAnnotation)).toBe(true);
  });

  // Whatever it was labelled, a FeatureCollection body is the shape a renderer can actually use
  it('recognizes a FeatureCollection body on its own', () => {
    expect(isGeoreferenceAnnotation({ body: { type: 'FeatureCollection' } })).toBe(true);
  });

  it.each([
    ['a painting annotation', { motivation: 'painting', body: { type: 'Image' } }],
    ['an annotation page', { type: 'AnnotationPage', items: [] }],
    ['a bare object', {}],
    ['null', null],
    ['a string', 'georeferencing'],
  ])('does not mistake %s for georeference data', (_label, node) => {
    expect(isGeoreferenceAnnotation(node)).toBe(false);
  });
});

describe('findGeoreferenceAnnotation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finds nothing in an annotation tree that has none', async () => {
    const page = { type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'painting', body: { type: 'Image' } }] };

    expect(await findGeoreferenceAnnotation(page)).toBeUndefined();
  });

  // The shape Stanford's purl serves: the canvas links a page, whose 'painting' annotation carries
  // the Allmaps page as its body, and the georeferencing annotation is inside that. Verified against
  // https://purl.stanford.edu/bb013fz9675/iiif3/manifest - so the walk must not stop at the first
  // annotation, nor assume the georeferencing one sits directly in the page the canvas named.
  it('follows a referenced page into an annotation whose body is another page', async () => {
    const allmapsPage = { id: 'https://annotations.allmaps.org/images/eb37cc5b4efc281c', type: 'AnnotationPage', items: [georeferenceAnnotation] };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        type: 'AnnotationPage',
        items: [{ type: 'Annotation', motivation: 'painting', body: allmapsPage }],
      }),
    );

    const found = await findGeoreferenceAnnotation({ id: 'https://purl.stanford.edu/bb013fz9675/iiif3/annotations/one', type: 'AnnotationPage' });

    // The containing page, not the single annotation inside it: a scan georeferenced as several maps
    // has to reach the renderer whole
    expect(found).toEqual(allmapsPage);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('reads a page it was handed whole without fetching anything', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const page = { type: 'AnnotationPage', items: [georeferenceAnnotation] };

    expect(await findGeoreferenceAnnotation(page)).toEqual(page);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies the request transform when it dereferences a page', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ type: 'AnnotationPage', items: [georeferenceAnnotation] }));
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });

    await findGeoreferenceAnnotation({ id: 'https://example.com/annotations/one', type: 'AnnotationPage' }, transform);

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/annotations/one', { headers: { Authorization: 'Bearer token' } });
  });

  // The image is still perfectly previewable, so an unreadable annotation page is not worth failing
  it('gives up quietly on a page it cannot read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('offline'));

    expect(await findGeoreferenceAnnotation({ id: 'https://example.com/annotations/one', type: 'AnnotationPage' })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('gives up on a page that responds with an error status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));

    expect(await findGeoreferenceAnnotation({ id: 'https://example.com/annotations/one', type: 'AnnotationPage' })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  // A page that references itself, which a walk with no depth limit would follow until it ran out
  // of memory or requests
  it('stops rather than following a cycle forever', async () => {
    const selfReferential = { id: 'https://example.com/annotations/loop', type: 'AnnotationPage' };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ type: 'AnnotationPage', items: [{ type: 'Annotation', body: selfReferential }] }));

    expect(await findGeoreferenceAnnotation(selfReferential)).toBeUndefined();
    expect(fetchSpy.mock.calls.length).toBeLessThan(10);
  });

  it('searches every annotation in a page rather than only the first', async () => {
    const page = {
      type: 'AnnotationPage',
      items: [
        { type: 'Annotation', motivation: 'painting', body: { type: 'Image' } },
        { type: 'Annotation', body: { type: 'FeatureCollection' } },
      ],
    };

    expect(await findGeoreferenceAnnotation(page)).toEqual(page);
  });

  it('looks through every body of an annotation that has several', async () => {
    const annotation = { type: 'Annotation', body: [{ type: 'Image' }, { type: 'AnnotationPage', items: [georeferenceAnnotation] }] };

    expect(await findGeoreferenceAnnotation(annotation)).toEqual({ type: 'AnnotationPage', items: [georeferenceAnnotation] });
  });
});
