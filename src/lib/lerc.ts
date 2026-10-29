import { DECODER_REGISTRY } from '@developmentseed/geotiff';

const LERC_COMPRESSION = 34887;

let located = false;

// Initialize LERC with the bundled wasm URL before the upstream codec can cache its default location.
export function locateLercWasm(): void {
  if (located) return;

  const codec = DECODER_REGISTRY.get(LERC_COMPRESSION);
  if (!codec) return;

  located = true;
  DECODER_REGISTRY.set(LERC_COMPRESSION, async () => {
    const [{ load }, { lercWasmUrl }] = await Promise.all([import('lerc'), import('./lerc-wasm.generated')]);
    await load({ locateFile: () => lercWasmUrl });
    return await codec();
  });
}
