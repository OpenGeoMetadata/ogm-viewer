/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { fieldDefinitions } from './field-definitions';
import { quantityLabel, rasterQuantity } from './quantity';
import { References } from './references';

// One read per URL is held for the life of the page, so every test needs a URL of its own rather
// than the answer another test already cached
let unique = 0;
const url = (name: string) => `https://example.com/${name}-${++unique}.xml`;

// A 3DEP 1/3 arc-second tile's FGDC, trimmed to its spatial reference. All the record says about
// its values is here: its Entity and Attribute section only points at a data dictionary.
const DEM13 = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE metadata SYSTEM "https://www.fgdc.gov/schemas/metadata/fgdc-std-001-1998.dtd">
<metadata>
  <spref>
    <horizsys>
      <geograph><geogunit>Decimal degrees</geogunit></geograph>
    </horizsys>
    <vertdef>
      <altsys>
        <altdatum>North American Vertical Datum of 1988</altdatum>
        <altres>1.000000</altres>
        <altunits>meters</altunits>
        <altenc>Implicit coordinate</altenc>
      </altsys>
    </vertdef>
  </spref>
  <eainfo>
    <overview>
      <eaover>The attribute summary can be found in the Data Dictionary (http://nationalmap.gov/3DEP/3dep_prodmetadata.html).</eaover>
    </overview>
  </eainfo>
</metadata>`;

// A 3DEP Seamless 1-Meter cell's, which also describes its one attribute - in a unit spelled its
// own way, and under a name that says nothing about what it is
const S1M = `<metadata>
  <spref>
    <vertdef>
      <altsys>
        <altdatum>North American Vertical Datum of 1988</altdatum>
        <altres>0.01</altres>
        <altunits>meters</altunits>
      </altsys>
    </vertdef>
  </spref>
  <eainfo>
    <detailed>
      <attr>
        <attrlabl>Value</attrlabl>
        <attrdef>Unique numeric values contained in each raster cell.</attrdef>
        <attrdomv><rdom><rdommin>971.71936035156</rdommin><rdommax>1427.8289794922</rdommax><attrunit>Meter</attrunit></rdom></attrdomv>
      </attr>
    </detailed>
  </eainfo>
</metadata>`;

// A bathymetric grid's, which measures down from a tidal datum instead
const BATHYMETRY = `<metadata>
  <spref>
    <vertdef>
      <depthsys>
        <depthdn>Mean lower low water</depthdn>
        <depthres>0.1</depthres>
        <depthdu>meters</depthdu>
        <depthem>Attribute values</depthem>
      </depthsys>
    </vertdef>
  </spref>
</metadata>`;

const respondWith = (bodies: Record<string, string>, contentType = 'application/xml') =>
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const requested = input.toString();
    const body = Object.entries(bodies).find(([match]) => requested.includes(match))?.[1];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      statusText: body === undefined ? 'Not Found' : 'OK',
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => body ?? '',
    } as unknown as Response;
  });

describe('rasterQuantity', () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a DEM's elevations, their unit and their datum out of its vertical coordinate system", async () => {
    const fgdc = url('dem13');
    respondWith({ dem13: DEM13 });

    expect(await rasterQuantity(fgdc)).toEqual({ name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' });
  });

  // The attribute's own unit says the same thing in other words, and its name says nothing at all
  it('goes by the vertical coordinate system even where an attribute names a unit too', async () => {
    const fgdc = url('s1m');
    respondWith({ s1m: S1M });

    expect(await rasterQuantity(fgdc)).toEqual({ name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' });
  });

  it('reads depths from a depth system', async () => {
    const fgdc = url('bathymetry');
    respondWith({ bathymetry: BATHYMETRY });

    expect(await rasterQuantity(fgdc)).toEqual({ name: 'Depth', unit: 'meters', datum: 'Mean lower low water' });
  });

  // A topobathymetric model stores heights, negative below the datum, whichever systems it defines
  it('prefers altitudes when a document defines depths as well', async () => {
    const fgdc = url('topobathy');
    respondWith({ topobathy: BATHYMETRY.replace('<vertdef>', '<vertdef><altsys><altdatum>NAVD 88</altdatum><altunits>meters</altunits></altsys>') });

    expect((await rasterQuantity(fgdc))?.name).toEqual('Elevation');
  });

  it('leaves out a unit or a datum the document left blank', async () => {
    const fgdc = url('blank');
    respondWith({ blank: '<metadata><spref><vertdef><altsys><altdatum> </altdatum></altsys></vertdef></spref></metadata>' });

    expect(await rasterQuantity(fgdc)).toEqual({ name: 'Elevation' });
  });

  // Most rasters' FGDC - Stanford's precipitation and land cover grids, a scanned map's - has no
  // vertical coordinate system, and their values are nothing a vertical datum is about
  it('says nothing about a document with no vertical coordinate system', async () => {
    const fgdc = url('flat');
    respondWith({ flat: '<metadata><spref><horizsys /></spref></metadata>' });

    expect(await rasterQuantity(fgdc)).toBeUndefined();
  });

  it('says nothing, and asks nothing, for a record with no FGDC', async () => {
    const fetchSpy = respondWith({});

    expect(await rasterQuantity(undefined)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says nothing about a document that cannot be read', async () => {
    const fgdc = url('missing');
    respondWith({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await rasterQuantity(fgdc)).toBeUndefined();
    expect(warn.mock.calls[0][0]).toContain(fgdc);
  });

  it('refuses a login page served in place of the document', async () => {
    const fgdc = url('login');
    respondWith({ login: '<!DOCTYPE html><html><body>Sign in</body></html>' }, 'text/html;charset=utf-8');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await rasterQuantity(fgdc)).toBeUndefined();
  });

  // The sidebar reads the record's FGDC for its field definitions as the record loads, and the
  // legend reads the same document for this - one request between them
  it('shares one read of the document with fieldDefinitions', async () => {
    const fgdc = url('shared');
    const fetchSpy = respondWith({ shared: S1M });

    const [definitions, quantity] = await Promise.all([fieldDefinitions(new References(JSON.stringify({ 'http://www.opengis.net/cat/csw/csdgm': fgdc }))), rasterQuantity(fgdc)]);
    expect(await rasterQuantity(fgdc)).toEqual(quantity);

    expect(definitions?.has('value')).toBe(true);
    expect(quantity?.name).toEqual('Elevation');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure rather than remembering it', async () => {
    const fgdc = url('retry');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = respondWith({});

    expect(await rasterQuantity(fgdc)).toBeUndefined();
    failing.mockRestore();
    respondWith({ retry: DEM13 });

    expect((await rasterQuantity(fgdc))?.unit).toEqual('meters');
  });
});

describe('quantityLabel', () => {
  it('names the quantity with its unit', () => {
    expect(quantityLabel({ name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' })).toEqual('Elevation (meters)');
  });

  it('names the quantity alone when there is no unit', () => {
    expect(quantityLabel({ name: 'Depth' })).toEqual('Depth');
  });
});
