// Register the components under test as custom elements. The custom-elements build has no loader to
// call: importing a component entry defines that component and everything it renders.
//
// Deliberately not ogm-viewer, which would define all eleven: it is the only component that imports
// the Web Awesome element modules, and pulling those in would upgrade every wa-* element the other
// components render. That would drag Web Awesome's own shadow DOM - lit marker comments and all -
// into assertions that are about our markup, and break them on every Web Awesome release. Left
// undefined, wa-* elements stay inert, which is what these tests were written against.
//
// Anything rendering ogm-viewer or ogm-sidebar needs a real browser rather than happy-dom, since
// Web Awesome's form controls want ElementInternals as they upgrade.
import './dist/components/ogm-alerts.js';
import './dist/components/ogm-attributes.js';
import './dist/components/ogm-layers.js';
import './dist/components/ogm-menubar.js';
import './dist/components/ogm-metadata.js';
import './dist/components/ogm-preview.js';
import './dist/components/ogm-previews.js';

// Stand in for the mark that bootstrapLazy() would have set. Dev builds compile in Stencil's
// profiling hooks, and appDidLoad measures against "st:app:start" - but only the lazy loader ever
// marks it, so under this output target every component load rejects with "the mark has not been
// set". Harmless in itself, but vitest counts unhandled rejections and fails the run over them.
// Production builds drop the profiling code entirely, so this is a test-only gap.
performance.mark('st:app:start');

export {};

// Note: this reads the built output, so `npm run build` has to have run first.
