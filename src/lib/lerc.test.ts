import { describe, it, expect, vi } from 'vitest';

import type { Decoder } from '@developmentseed/geotiff';

const { load } = vi.hoisted(() => ({ load: vi.fn(async (_options?: { locateFile?: () => string }) => {}) }));
vi.mock('lerc', () => ({ load }));

const WASM = 'data:application/wasm;base64,AGFzbQEAAAA=';
vi.mock('./lerc-wasm.generated', () => ({ lercWasmUrl: WASM }));

const LERC_COMPRESSION = 34887;

async function freshly() {
  vi.resetModules();
  load.mockClear();

  const [{ locateLercWasm }, { DECODER_REGISTRY }] = await Promise.all([import('./lerc'), import('@developmentseed/geotiff')]);
  return { locateLercWasm, registry: DECODER_REGISTRY };
}

const stubCodec = () => {
  const decoder = vi.fn() as unknown as Decoder;
  return { decoder, codec: vi.fn(async () => decoder) };
};

describe('locateLercWasm', () => {
  it('loads lerc wasm from the URL compiled into the bundle, before the codec it wraps is reached', async () => {
    const { locateLercWasm, registry } = await freshly();
    const { codec, decoder } = stubCodec();
    registry.set(LERC_COMPRESSION, codec);

    locateLercWasm();

    expect(await registry.get(LERC_COMPRESSION)!()).toBe(decoder);
    expect(load.mock.calls[0]?.[0]?.locateFile?.()).toEqual(WASM);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(codec.mock.invocationCallOrder[0]);
  });

  it('loads nothing until something asks to decode a LERC tile', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.set(LERC_COMPRESSION, stubCodec().codec);

    locateLercWasm();

    expect(load).not.toHaveBeenCalled();
  });

  it('wraps the codec once however many times it is asked', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.set(LERC_COMPRESSION, stubCodec().codec);

    locateLercWasm();
    const wrapped = registry.get(LERC_COMPRESSION);
    locateLercWasm();

    expect(registry.get(LERC_COMPRESSION)).toBe(wrapped);
  });

  it('registers nothing of its own when upstream has no LERC codec', async () => {
    const { locateLercWasm, registry } = await freshly();
    registry.delete(LERC_COMPRESSION);

    locateLercWasm();

    expect(registry.has(LERC_COMPRESSION)).toBe(false);
  });
});
