// The bundled decoder worker, inlined here at build time by stencil.config.ts.
//
// Empty as written, and empty in any build that doesn't run that plugin - which is the case for the
// unit tests, since they import this module rather than the built output. An empty source is what
// makes createDecoderPool fall back to decoding on the main thread instead of starting a worker with
// no decoder in it, so a build without the plugin is slower rather than broken.
export const DECODER_WORKER_SOURCE = '';
