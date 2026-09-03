// The gaps happy-dom leaves, and the network guards - see there for both
import './vitest-setup-dom';

// Register the components under test as custom elements. The custom-elements build has no loader to
// call: importing a component entry defines that component and everything it renders - including
// the wa-* elements the component imports for itself, which do get upgraded here.
import './dist/components/ogm-alerts.js';
import './dist/components/ogm-attributes.js';
import './dist/components/ogm-image.js';
import './dist/components/ogm-layers.js';
import './dist/components/ogm-legend.js';
import './dist/components/ogm-locator.js';
import './dist/components/ogm-map.js';
import './dist/components/ogm-menubar.js';
import './dist/components/ogm-metadata.js';
import './dist/components/ogm-overview.js';
import './dist/components/ogm-preview.js';
import './dist/components/ogm-previews.js';
import './dist/components/ogm-search.js';

// Stand in for the mark that bootstrapLazy() would have set. Dev builds compile in Stencil's
// profiling hooks, and appDidLoad measures against "st:app:start" - but only the lazy loader ever
// marks it, so under this output target every component load rejects with "the mark has not been
// set". Harmless in itself, but vitest counts unhandled rejections and fails the run over them.
// Production builds drop the profiling code entirely, so this is a test-only gap.
performance.mark('st:app:start');

export {};

// Note: this reads the built output, so `npm run build` has to have run first.
