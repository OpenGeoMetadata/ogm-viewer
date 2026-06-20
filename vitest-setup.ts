// Load Stencil components and register them as custom elements.
import { defineCustomElements } from './dist/esm/loader.js';
defineCustomElements();
export {};

// Note: you may need `buildDist: true` in your stencil.config
// or `--prod` to use an output other than the browser lazy-loader
