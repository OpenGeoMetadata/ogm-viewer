import './vitest-setup-dom';

import './dist/components/ogm-alerts.js';
import './dist/components/ogm-attributes.js';
import './dist/components/ogm-fields.js';
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
import './dist/components/ogm-time.js';
import './dist/components/ogm-viewer.js';

// The custom-elements build skips the lazy loader, which normally creates this profiling mark.
performance.mark('st:app:start');

export {};
