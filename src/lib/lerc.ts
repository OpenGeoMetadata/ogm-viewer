import { DECODER_REGISTRY } from '@developmentseed/geotiff';

// LERC's TIFF compression tag. Written out rather than taken from @cogeotiff/core's Compression enum,
// which this library doesn't depend on directly; see the note on DecodeArguments in src/lib/decoder.ts.
const LERC_COMPRESSION = 34887;

// Whether the registry entry below has already been wrapped. One realm only ever needs it once, and
// wrapping the wrapper would leave the inner one loading the wasm a second time.
let located = false;

/**
 * Tell lerc where the WebAssembly module it needs actually is, so a LERC-compressed COG can be
 * decoded at all.
 *
 * lerc is emscripten output, and the half of it that does the work is a separate lerc-wasm.wasm that
 * the JavaScript half fetches the first time it decodes anything. Left alone it looks for that file
 * beside whichever chunk it was bundled into, and there was never anything there: this package
 * published no .wasm, an app that bundles us would not have carried one anyway, and a decoder worker
 * built from a blob: URL has no directory for a relative path to resolve against in the first place.
 * Every tile of every LERC COG failed, which for Esri elevation data is every tile there is.
 *
 * So the wasm stops being a file. scripts/inline-assets.mjs compiles it into the library as a data
 * URL - the same answer, and for the same reason, as the theme and the icons in ./assets.generated -
 * and this hands lerc that URL. A URL is the only form it takes: load() forwards nothing but
 * locateFile to the module underneath, so there is no way to pass it bytes.
 *
 * Through the decoder registry rather than by calling load() outright, because load() instantiates
 * the wasm there and then: most COGs are not LERC, and this is the largest thing the library carries.
 * Wrapping the registry entry keeps both the module and its 156 KB of base64 behind a dynamic import
 * that nothing reaches until a LERC tile actually arrives - while still getting in ahead of upstream's
 * own codec, which calls load() with no options at all. Being first is the whole game: load() answers
 * its first caller for the life of the realm.
 *
 * Called once per realm, since the registry is per-realm too: the main thread does it in
 * src/lib/decoder.ts, and each worker in src/lib/decoder-worker-lerc.ts.
 *
 * Decoding is the whole of what a LERC COG needed from us, but only half of what it needed: the codec
 * answers with a band-separate raster whatever the file's layout, and
 * @developmentseed/deck.gl-geotiff's own pipeline throws "Band-separate images not yet implemented."
 * on any of those. What gets past that is src/lib/previewers/cog-pipeline.ts, which reads a single
 * band off a colour ramp and takes band-separate in its stride - so a scalar LERC COG, which is what
 * LERC is for and what assets/records/lerc-cog.json is, now draws.
 *
 * Multi-band LERC does not. isScalarSampleFormat only claims a single band of signed integers or
 * floats; RGB imagery and unsigned rasters are left to upstream's pipeline, which is still where the
 * band-separate throw lives - so for those the wall stands, and with it
 * https://github.com/OpenGeoMetadata/ogm-viewer/issues/158. Rarer than it sounds for LERC in
 * particular: LERC exists for rasters whose precision is known, which is mostly elevation, and
 * elevation is one band of floats.
 */
export function locateLercWasm(): void {
  if (located) return;

  // Upstream registers the codec itself, and this only decides where its wasm comes from. If a
  // version of the package ever stops registering one, there is nothing here worth putting in its
  // place: a LERC tile would then fail as an unsupported compression, which says so plainly.
  const codec = DECODER_REGISTRY.get(LERC_COMPRESSION);
  if (!codec) return;

  located = true;
  DECODER_REGISTRY.set(LERC_COMPRESSION, async () => {
    const [{ load }, { lercWasmUrl }] = await Promise.all([import('lerc'), import('./lerc-wasm.generated')]);
    await load({ locateFile: () => lercWasmUrl });
    return await codec();
  });
}
