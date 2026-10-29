import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { describeSheet, sheetHasImage, sheetThumbnail, sheetWebsite } from './openindexmap';
import type { RequestTransform } from './request';

const MILLIONTH_MAP = {
  label: 'SB 24',
  available: true,
  west: -42,
  east: -36,
  north: -4,
  south: -8,
  datePub: '1936',
  recId: 'am002175',
  title: 'Jaguaribe',
  publisher: 'American Geographical Society of New York',
  projection: 'polyconic',
  color: 'colored',
  inst: 'American Geographical Society Library – UWM Libraries',
  instCallNo: '050-b A-1:1,000,000',
  fileName: 'am002175.tif',
  digHold: 'https://collections.lib.uwm.edu/digital/collection/agdm/id/4878/',
  websiteUrl: 'https://collections.lib.uwm.edu/digital/collection/agdm/id/4878/',
  thumbUrl: 'https://collections.lib.uwm.edu/digital/api/singleitem/image/agdm/4878/default.jpg',
  download: 'https://collections.lib.uwm.edu/digital/download/collection/agdm/id/4878/size/full',
  iiifUrl: 'https://collections.lib.uwm.edu/iiif/info/agdm/4878/manifest.json',
};

const UNHELD_SHEET = {
  Id: 0,
  Sheet_ID: 'SHEET 28',
  label: 'SHEET 28',
  call_short: '0',
  call_num: '0',
  recid: '0',
  websiteUrl: '0',
  title: '0',
  ckey: 0,
  available: false,
  iiifUrl: '0',
};

const labels = (properties: Record<string, unknown>) => describeSheet(properties).map(({ label }) => label);
const row = (properties: Record<string, unknown>, label: string) => describeSheet(properties).find(field => field.label === label);

const respondWith = (body: unknown) =>
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);

describe('describeSheet', () => {
  it('names the properties the spec defines rather than showing their keys', () => {
    expect(row(MILLIONTH_MAP, 'Sheet')?.value).toEqual('SB 24');
    expect(row(MILLIONTH_MAP, 'Published')?.value).toEqual('1936');
    expect(row(MILLIONTH_MAP, 'Call number')?.value).toEqual('050-b A-1:1,000,000');
    expect(row(MILLIONTH_MAP, 'Record ID')?.value).toEqual('am002175');
  });

  it('leads with what the sheet is and leaves the extents until last', () => {
    expect(labels(MILLIONTH_MAP).slice(0, 3)).toEqual(['Sheet', 'Title', 'Published']);
    expect(labels(MILLIONTH_MAP).slice(-4)).toEqual(['West', 'East', 'North', 'South']);
  });

  it("keeps the properties the spec doesn't define, under their own keys, after the ones it does", () => {
    expect(labels(UNHELD_SHEET)).toEqual(['Sheet', 'Title', 'Available', 'Web link', 'IIIF manifest', 'Id', 'Sheet_ID', 'call_short', 'call_num', 'recid', 'ckey']);
  });

  it('gives the three link properties somewhere to go, and something to read', () => {
    expect(row(MILLIONTH_MAP, 'Web link')).toMatchObject({ value: 'View this map', href: MILLIONTH_MAP.websiteUrl });
    expect(row(MILLIONTH_MAP, 'Download')).toMatchObject({ value: 'Download this map', href: MILLIONTH_MAP.download });
    expect(row(MILLIONTH_MAP, 'IIIF manifest')).toMatchObject({ value: 'View manifest', href: MILLIONTH_MAP.iiifUrl });
  });

  it('leaves a property that is only sometimes a link alone', () => {
    expect(row(MILLIONTH_MAP, 'Digital holdings')?.value).toEqual(MILLIONTH_MAP.digHold);
    expect(row(MILLIONTH_MAP, 'Digital holdings')?.href).toBeUndefined();
  });

  it('refuses to make a link out of a placeholder that was never a URL', () => {
    expect(row(UNHELD_SHEET, 'Web link')?.value).toEqual('0');
    expect(row(UNHELD_SHEET, 'Web link')?.href).toBeUndefined();
    expect(row(UNHELD_SHEET, 'IIIF manifest')?.href).toBeUndefined();
  });

  it('refuses a scheme that could run something', () => {
    expect(row({ websiteUrl: 'javascript:alert(1)' }, 'Web link')?.href).toBeUndefined();
  });

  it('answers a flag rather than restating it', () => {
    expect(row(MILLIONTH_MAP, 'Available')?.value).toEqual('Yes');
    expect(row(UNHELD_SHEET, 'Available')?.value).toEqual('No');
  });

  it('reads a list of place names as a list', () => {
    expect(row({ location: ['Jaguaribe', 'Ceará'] }, 'Location')?.value).toEqual('Jaguaribe, Ceará');
  });

  it('leaves out the properties with nothing in them', () => {
    expect(labels({ label: 'SB 24', title: null, note: '', scale: undefined, edition: '2nd' })).toEqual(['Sheet', 'Edition']);
  });

  it('keeps a zero, which is a real extent', () => {
    expect(row({ west: 0 }, 'West')?.value).toEqual('0');
  });

  it('gives the thumbnail no row of its own', () => {
    expect(labels(MILLIONTH_MAP)).not.toContain('thumbUrl');
    expect(describeSheet(MILLIONTH_MAP).map(({ key }) => key)).not.toContain('thumbUrl');
  });

  it('describes a feature with no properties at all as nothing', () => {
    expect(describeSheet(null)).toEqual([]);
  });
});

describe('sheetWebsite', () => {
  it('is where the sheet says to go', () => {
    expect(sheetWebsite(MILLIONTH_MAP)).toEqual(MILLIONTH_MAP.websiteUrl);
  });

  it('is nowhere when the sheet only has a placeholder', () => {
    expect(sheetWebsite(UNHELD_SHEET)).toBeUndefined();
  });
});

describe('sheetHasImage', () => {
  it('is true for a sheet with a thumbnail of its own', () => {
    expect(sheetHasImage(MILLIONTH_MAP)).toBe(true);
  });

  it('is true for a sheet with only a manifest to read one out of', () => {
    expect(sheetHasImage({ label: 'SHEET 3', iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif/manifest' })).toBe(true);
  });

  it('is false for a sheet with neither', () => {
    expect(sheetHasImage({ label: 'SB 25' })).toBe(false);
  });

  it('is false for a sheet whose placeholders were never URLs', () => {
    expect(sheetHasImage(UNHELD_SHEET)).toBe(false);
  });
});

describe('sheetThumbnail', () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes thumbUrl at its word, without asking anyone's server", async () => {
    const fetchSpy = respondWith({});

    expect(await sheetThumbnail(MILLIONTH_MAP)).toEqual(MILLIONTH_MAP.thumbUrl);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads one out of a Presentation 2 manifest, where it is @id', async () => {
    const fetchSpy = respondWith({
      '@context': 'http://iiif.io/api/presentation/2/context.json',
      'thumbnail': { '@id': 'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg', '@type': 'dctypes:Image' },
    });

    expect(await sheetThumbnail({ iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif/manifest' })).toEqual(
      'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg',
    );
    expect(fetchSpy.mock.calls[0][0]).toEqual('https://purl.stanford.edu/kh108fv7858/iiif/manifest');
  });

  it('reads one out of a Presentation 3 manifest, where it is a list', async () => {
    respondWith({
      '@context': ['http://iiif.io/api/presentation/3/context.json'],
      'thumbnail': [{ type: 'Image', id: 'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg' }],
    });

    expect(await sheetThumbnail({ iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif3/manifest' })).toEqual(
      'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg',
    );
  });

  it('takes a manifest that gives the thumbnail as a bare string', async () => {
    respondWith({ thumbnail: 'https://example.com/thumb.jpg' });

    expect(await sheetThumbnail({ iiifUrl: 'https://example.com/manifest.json' })).toEqual('https://example.com/thumb.jpg');
  });

  it('carries the request transform, so a restricted sheet can still be pictured', async () => {
    const fetchSpy = respondWith({ thumbnail: 'https://example.com/thumb.jpg' });
    const withCookies: RequestTransform = () => ({ credentials: 'include' });

    await sheetThumbnail({ iiifUrl: 'https://example.com/manifest.json' }, withCookies);

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('asks about a manifest as metadata, which is what it is', async () => {
    respondWith({});
    const transform = vi.fn().mockReturnValue(undefined);

    await sheetThumbnail({ iiifUrl: 'https://example.com/manifest.json' }, transform);

    expect(transform).toHaveBeenCalledWith('https://example.com/manifest.json', 'metadata');
  });

  it('asks nobody when there is neither a thumbnail nor a manifest', async () => {
    const fetchSpy = respondWith({});

    expect(await sheetThumbnail(UNHELD_SHEET)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('goes without rather than failing when the manifest refuses to be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as unknown as Response);

    expect(await sheetThumbnail({ iiifUrl: 'https://example.com/manifest.json' })).toBeUndefined();
  });

  it('goes without when the manifest has no thumbnail to give', async () => {
    respondWith({ '@context': 'http://iiif.io/api/presentation/2/context.json', 'sequences': [] });

    expect(await sheetThumbnail({ iiifUrl: 'https://example.com/manifest.json' })).toBeUndefined();
  });
});
