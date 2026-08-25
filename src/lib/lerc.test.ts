import { describe, it, expect, vi } from 'vitest';

import type { Decoder } from '@developmentseed/geotiff';

// lerc's own load(), which is what all of this exists to get options into. Mocked because the real
// one instantiates a WebAssembly module, and what matters here is only where it was told to find it.
const { load } = vi.hoisted(() => ({ load: vi.fn(async (_options?: { locateFile?: () => string }) => {}) }));
vi.mock('lerc', () => ({ load }));

// The wasm the build compiles in, which is 156 KB of base64 in the real thing
const WASM = 'data:application/wasm;base64,AGFzbQEAAAA=';
vi.mock('./lerc-wasm.generated', () => ({ lercWasmUrl: WASM }));

// LERC's TIFF compression tag, as in lerc.ts
const LERC_COMPRESSION = 34887;

// A fresh copy of the module under test and of the registry it writes to, since both remember what
// has already happened: locateLercWasm wraps the entry once per realm, and the registry is the realm.
async function freshly() {
  vi.resetModules();
  load.mockClear();

  const [{ locateLercWasm }, { DECODER_REGISTRY }] = await Promise.all([import('./lerc'), import('@developmentseed/geotiff')]);
  return { locateLercWasm, registry: DECODER_REGISTRY };
}

// Stands in for the codec upstream registers, so a test can see whether it was reached and with what
// already done. Answers a decoder rather than being one - that is the shape the registry holds.
const stubCodec = () => {
  const decoder = vi.fn() as unknown as Decoder;
  return { decoder, codec: vi.fn(async () => decoder) };
};

describe('locateLercWasm', () => {
  // The whole point: upstream's codec calls lerc.load() with no options, which sends lerc looking for
  // a wasm file beside its own chunk - a file nothing ships, and in a worker not even a resolvable
  // path. load() answers its first caller for the life of the realm, so getting in first is the fix.
  it('loads lerc wasm from the URL compiled into the bundle, before the codec it wraps is reached', async () => {
    const { locateLercWasm, registry } = await freshly();
    const { codec, decoder } = stubCodec();
    registry.set(LERC_COMPRESSION, codec);

    locateLercWasm();

    expect(await registry.get(LERC_COMPRESSION)!()).toBe(decoder);
    expect(load.mock.calls[0]?.[0]?.locateFile?.()).toEqual(WASM);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(codec.mock.invocationCallOrder[0]);
  });

  // Nothing is instantiated, and the base64 chunk holding it is not even fetched, until a LERC tile
  // actually turns up: most COGs are not LERC, and this is the largest thing the library carries.
  it('loads nothing until something asks to decode a LERC tile', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.set(LERC_COMPRESSION, stubCodec().codec);

    locateLercWasm();

    expect(load).not.toHaveBeenCalled();
  });

  // Every pool asks, and there is more than one way to end up building a second one. Wrapping the
  // wrapper would leave the inner one loading the wasm all over again.
  it('wraps the codec once however many times it is asked', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.set(LERC_COMPRESSION, stubCodec().codec);

    locateLercWasm();
    const wrapped = registry.get(LERC_COMPRESSION);
    locateLercWasm();

    expect(registry.get(LERC_COMPRESSION)).toBe(wrapped);
  });

  // Upstream registers the codec, and this only decides where its wasm comes from. With no codec to
  // wrap there is nothing worth putting in its place: a LERC tile then fails as an unsupported
  // compression, which says so plainly.
  it('registers nothing of its own when upstream has no LERC codec', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.delete(LERC_COMPRESSION);

    locateLercWasm();

    expect(registry.has(LERC_COMPRESSION)).toBe(false);
  });
});
