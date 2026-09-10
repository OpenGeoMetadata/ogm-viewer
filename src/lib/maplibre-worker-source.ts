// MapLibre's own worker, bundled and inlined here at build time by stencil.config.ts.
//
// Empty as written, and empty in any build that doesn't run that plugin - which is the case for the
// unit tests, since they import this module rather than the built output. An empty source leaves
// MapLibre looking for the worker beside whichever chunk it landed in, which is the thing createMap
// is avoiding; see src/lib/maps.ts.
export const MAPLIBRE_WORKER_SOURCE = '';
