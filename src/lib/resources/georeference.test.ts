import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { declaresGeoreferencing, findGeoreferenceAnnotation, findGeoreferenceAnnotations, isGeoreferenceAnnotation } from './georeference';
import type { RequestTransform } from '../request';

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

  it.each(['http://iiif.io/api/extension/georef/1/context.json', 'https://iiif.io/api/extension/georef/1/context.json'])('recognizes the %s context', context => {
    expect(isGeoreferenceAnnotation({ '@context': context })).toBe(true);
  });

  it('recognizes the context among several', () => {
    expect(isGeoreferenceAnnotation(georeferenceAnnotation)).toBe(true);
  });

  it('recognizes a FeatureCollection body on its own', () => {
    expect(isGeoreferenceAnnotation({ body: { type: 'FeatureCollection' } })).toBe(true);
  });

  it.each([
    ['a painting annotation', { motivation: 'painting', body: { type: 'Image' } }],
    ['an annotation page', { type: 'AnnotationPage', items: [] }],
    ['a page that declares georeferencing', { id: 'https://example.com/annotations/one', type: 'AnnotationPage', motivation: 'georeferencing' }],
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

  it('follows a referenced page into an annotation whose body is another page', async () => {
    const allmapsPage = { id: 'https://annotations.allmaps.org/images/eb37cc5b4efc281c', type: 'AnnotationPage', items: [georeferenceAnnotation] };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        type: 'AnnotationPage',
        items: [{ type: 'Annotation', motivation: 'painting', body: allmapsPage }],
      }),
    );

    const found = await findGeoreferenceAnnotation({ id: 'https://purl.stanford.edu/bb013fz9675/iiif3/annotations/one', type: 'AnnotationPage' });

    expect(found).toEqual(allmapsPage);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns the items of a referenced page that holds the georeference annotations itself', async () => {
    const reference = { id: 'https://purl.stanford.edu/bb013fz9675/iiif3/annotations/one', type: 'AnnotationPage' };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ ...reference, items: [georeferenceAnnotation] }));

    expect(await findGeoreferenceAnnotation(reference)).toEqual({ ...reference, items: [georeferenceAnnotation] });
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

  it('stops rather than following a cycle forever', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

describe('declaresGeoreferencing', () => {
  it.each([
    ['a purpose', { type: 'AnnotationPage', purpose: 'georeferencing' }],
    ['a purpose among several', { type: 'AnnotationPage', purpose: ['describing', 'georeferencing'] }],
    ['a motivation', { type: 'AnnotationPage', motivation: 'georeferencing' }],
  ])('trusts a page that declares georeferencing as %s', (_label, page) => {
    expect(declaresGeoreferencing({ id: 'https://annotations.allmaps.org/images/one', ...page })).toBe(true);
  });

  it.each([
    ['a page that says nothing', { type: 'AnnotationPage' }],
    ['a page for something else', { type: 'AnnotationPage', purpose: 'commenting' }],
    ['an annotation rather than a page', { type: 'Annotation', motivation: 'georeferencing' }],
    ['null', null],
  ])('does not trust %s', (_label, node) => {
    expect(declaresGeoreferencing(node)).toBe(false);
  });
});

describe('findGeoreferenceAnnotations', () => {
  afterEach(() => vi.restoreAllMocks());

  const another = { ...georeferenceAnnotation, id: 'https://annotations.allmaps.org/maps/another' };

  it('finds nothing in an annotation tree that has none', async () => {
    expect(await findGeoreferenceAnnotations({ type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'painting', body: { type: 'Image' } }] })).toEqual([]);
  });

  it('keeps looking past the first match', async () => {
    const one = { type: 'AnnotationPage', items: [georeferenceAnnotation] };
    const two = { type: 'AnnotationPage', items: [another] };
    const annotation = { type: 'Annotation', body: [{ type: 'Image' }, one, two] };

    expect(await findGeoreferenceAnnotations(annotation)).toEqual([one, two]);
  });

  it('follows every referenced page rather than stopping after the first', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async url => jsonResponse({ type: 'AnnotationPage', items: [url === 'https://example.com/one' ? georeferenceAnnotation : another] }));
    const page = {
      type: 'AnnotationPage',
      items: [
        { type: 'Annotation', body: { id: 'https://example.com/one', type: 'AnnotationPage' } },
        { type: 'Annotation', body: { id: 'https://example.com/two', type: 'AnnotationPage' } },
      ],
    };

    const found = await findGeoreferenceAnnotations(page);

    expect(found.flatMap(node => node.items)).toEqual([georeferenceAnnotation, another]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reads a page that declares georeferencing rather than taking it for an annotation', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ type: 'AnnotationPage', items: [georeferenceAnnotation] }));
    const declared = { id: 'https://example.com/annotations/one', type: 'AnnotationPage', motivation: 'georeferencing' };

    expect(await findGeoreferenceAnnotations(declared)).toEqual([{ ...declared, items: [georeferenceAnnotation] }]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('hands back an annotation it was given whole', async () => {
    expect(await findGeoreferenceAnnotations(georeferenceAnnotation)).toEqual([georeferenceAnnotation]);
  });
});
