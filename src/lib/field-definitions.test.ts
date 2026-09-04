/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { fieldDefinitions } from './field-definitions';
import { References } from './references';

const FGDC_KEY = 'http://www.opengis.net/cat/csw/csdgm';
const GCO_KEY = 'http://www.isotc211.org/schemas/2005/gco';

// One read per URL is held for the life of the page, so every test needs a URL of its own rather
// than the answer another test already cached
let unique = 0;
const url = (name: string) => `https://example.com/${name}-${++unique}.xml`;

const referencesFor = (contents: Record<string, string>) => new References(JSON.stringify(contents));

// The Entity and Attribute section of a real CUGIR record, trimmed to two fields. Namespace-free,
// as FGDC always is.
const FGDC = `<metadata>
  <eainfo>
    <detailed>
      <enttyp><enttypl>cugir-007879</enttypl></enttyp>
      <attr>
        <attrlabl>ROUTETYPE</attrlabl>
        <attrdef>Type of touring route.</attrdef>
        <attrdomv>
          <edom><edomv>0</edomv><edomvd>No information / unknown / no public access.</edomvd></edom>
          <edom><edomv>3</edomv><edomvd>Tompkins County</edomvd></edom>
        </attrdomv>
      </attr>
      <attr>
        <attrlabl>NAME</attrlabl>
        <attrdef>Name of the road</attrdef>
      </attr>
    </detailed>
  </eainfo>
</metadata>`;

// A real Stanford feature catalogue, trimmed to one attribute - with the definitionReference kept,
// because that is the part a descendant search goes wrong on
const ISO19110 = `<gfc:FC_FeatureCatalogue xmlns:gfc="http://www.isotc211.org/2005/gfc" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:gmd="http://www.isotc211.org/2005/gmd">
  <gfc:featureType>
    <gfc:FC_FeatureType>
      <gfc:carrierOfCharacteristics>
        <gfc:FC_FeatureAttribute>
          <gfc:memberName><gco:LocalName>MTFCC</gco:LocalName></gfc:memberName>
          <gfc:definition><gco:CharacterString>MAF/TIGER feature class code of the primary feature for the edge</gco:CharacterString></gfc:definition>
          <gfc:definitionReference>
            <gfc:FC_DefinitionReference>
              <gfc:definitionSource>
                <gfc:FC_DefinitionSource>
                  <gfc:source>
                    <gmd:CI_Citation><gmd:title><gco:CharacterString>U.S. Census Bureau</gco:CharacterString></gmd:title></gmd:CI_Citation>
                  </gfc:source>
                </gfc:FC_DefinitionSource>
              </gfc:definitionSource>
            </gfc:FC_DefinitionReference>
          </gfc:definitionReference>
          <gfc:listedValue>
            <gfc:FC_ListedValue>
              <gfc:label><gco:CharacterString>C3023</gco:CharacterString></gfc:label>
              <gfc:definition><gco:CharacterString>Island</gco:CharacterString></gfc:definition>
            </gfc:FC_ListedValue>
          </gfc:listedValue>
        </gfc:FC_FeatureAttribute>
      </gfc:carrierOfCharacteristics>
    </gfc:FC_FeatureType>
  </gfc:featureType>
</gfc:FC_FeatureCatalogue>`;

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

describe('fieldDefinitions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads a field name, its definition and its coded values out of an FGDC document', async () => {
    const fgdc = url('fgdc');
    respondWith({ fgdc: FGDC });

    const definitions = await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc }));

    expect(definitions?.size).toEqual(2);
    expect(definitions?.get('routetype')).toEqual({
      name: 'ROUTETYPE',
      definition: 'Type of touring route.',
      codedValues: new Map([
        ['0', 'No information / unknown / no public access.'],
        ['3', 'Tompkins County'],
      ]),
    });
    // A field with no domain carries no codedValues key at all rather than an empty map
    expect(definitions?.get('name')).toEqual({ name: 'NAME', definition: 'Name of the road' });
  });

  // The two halves disagree about case: a GetFeatureInfo response says 'routetype' where the FGDC
  // describing it says 'ROUTETYPE'
  it('keys fields by their lower-cased name, keeping the name as written', async () => {
    const fgdc = url('case');
    respondWith({ case: FGDC });

    const definitions = await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc }));

    expect(Array.from(definitions?.keys() ?? [])).toEqual(['routetype', 'name']);
    expect(definitions?.get('routetype')?.name).toEqual('ROUTETYPE');
  });

  it('reads an ISO 19110 feature catalogue when that is all the record has', async () => {
    const iso = url('iso');
    respondWith({ iso: ISO19110 });

    const definitions = await fieldDefinitions(referencesFor({ [GCO_KEY]: iso }));

    expect(definitions?.get('mtfcc')).toEqual({
      name: 'MTFCC',
      definition: 'MAF/TIGER feature class code of the primary feature for the edge',
      // label holds the code and definition holds its meaning, which reads backwards but is what
      // the standard says
      codedValues: new Map([['C3023', 'Island']]),
    });
  });

  // The trap this test exists for: an attribute holds its listed values, each of which has a
  // definition, and a definitionReference citing where the wording came from. Asking the attribute
  // for "the definition anywhere inside me" finds one of those instead of the field's own.
  it("does not mistake a listed value's meaning or a citation for the field's definition", async () => {
    const iso = url('nested');
    respondWith({ nested: ISO19110 });

    const definitions = await fieldDefinitions(referencesFor({ [GCO_KEY]: iso }));

    expect(definitions?.get('mtfcc')?.definition).not.toEqual('Island');
    expect(definitions?.get('mtfcc')?.definition).not.toContain('Census Bureau');
  });

  // Where a record has both - Stanford's do - the FGDC is at least as complete and is the one that
  // decodes its values
  it('prefers the FGDC when a record points at both', async () => {
    const fgdc = url('preferred');
    const iso = url('ignored');
    const fetchSpy = respondWith({ preferred: FGDC, ignored: ISO19110 });

    const definitions = await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc, [GCO_KEY]: iso }));

    expect(definitions?.has('routetype')).toBe(true);
    expect(definitions?.has('mtfcc')).toBe(false);
    expect(fetchSpy.mock.calls.map(([requested]) => requested?.toString())).toEqual([fgdc]);
  });

  // An FGDC that turns out to describe nothing shouldn't cost the record its other document
  it('falls back to the ISO 19110 when the FGDC describes no fields', async () => {
    const fgdc = url('empty');
    const iso = url('fallback');
    respondWith({ empty: '<metadata><idinfo /></metadata>', fallback: ISO19110 });

    const definitions = await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc, [GCO_KEY]: iso }));

    expect(definitions?.has('mtfcc')).toBe(true);
  });

  it('says nothing, and asks nothing, for a record with neither reference', async () => {
    const fetchSpy = respondWith({});

    expect(await fieldDefinitions(referencesFor({ 'http://schema.org/downloadUrl': 'https://example.com/data.zip' }))).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Stanford answers an unauthenticated read with a redirect to the identity provider, and the login
  // page arrives with an OK status. Parsed as XML it describes no fields, which is indistinguishable
  // from a real document that says nothing - so it is caught by its content type instead.
  it('refuses a login page served in place of the document', async () => {
    const fgdc = url('login');
    respondWith({ login: '<!DOCTYPE html><html><body>Sign in</body></html>' }, 'text/html;charset=utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc }))).toBeUndefined();
    expect(warn.mock.calls[0][0]).toContain(fgdc);
  });

  it('says nothing about a document that cannot be read', async () => {
    respondWith({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await fieldDefinitions(referencesFor({ [FGDC_KEY]: url('missing') }))).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('says nothing about a document that describes no fields', async () => {
    const fgdc = url('quiet');
    respondWith({ quiet: '<metadata><idinfo><citation /></idinfo></metadata>' });

    expect(await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc }))).toBeUndefined();
  });

  // Two consumers ask at different moments - the attribute table on a click, the sidebar on load -
  // and one document read serves both
  it('reads one document once however many times it is asked for', async () => {
    const fgdc = url('shared');
    const fetchSpy = respondWith({ shared: FGDC });
    const references = referencesFor({ [FGDC_KEY]: fgdc });

    const [first, second] = await Promise.all([fieldDefinitions(references), fieldDefinitions(references)]);
    const third = await fieldDefinitions(referencesFor({ [FGDC_KEY]: fgdc }));

    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // A refused request shouldn't be the answer for the rest of the session: a session can be
  // established, or a token renewed, between one attempt and the next
  it('tries again after a failure rather than remembering it', async () => {
    const fgdc = url('retry');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = respondWith({});
    const references = referencesFor({ [FGDC_KEY]: fgdc });

    expect(await fieldDefinitions(references)).toBeUndefined();
    failing.mockRestore();
    respondWith({ retry: FGDC });

    expect((await fieldDefinitions(references))?.has('routetype')).toBe(true);
  });
});
