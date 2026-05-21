// Load Stencil components and register them as custom elements.
import { defineCustomElement as defineOgmViewer } from './dist/components/ogm-viewer.js';
import { defineCustomElement as defineOgmMetadata } from './dist/components/ogm-metadata.js';
import { defineCustomElement as defineOgmMenubar } from './dist/components/ogm-menubar.js';

defineOgmViewer();
defineOgmMetadata();
defineOgmMenubar();

export {};

// Note: you may need `buildDist: true` in your stencil.config
// or `--prod` to use an output other than the browser lazy-loader
