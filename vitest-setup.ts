// Enough of ElementInternals for Web Awesome's form controls to upgrade. happy-dom implements none
// of it (checked in 20.9), and <wa-button> reads validity out of it as it connects, so without this
// every component that renders one throws before its own markup exists to assert on. Nothing here
// is exercised by a test - it only has to not be undefined. Form behavior is Web Awesome's to test.
if (!HTMLElement.prototype.attachInternals) {
  HTMLElement.prototype.attachInternals = function attachInternals(this: HTMLElement) {
    return {
      form: null,
      labels: [] as unknown as NodeList,
      states: new Set<string>(),
      validationMessage: '',
      validity: { valid: true } as ValidityState,
      willValidate: false,
      checkValidity: () => true,
      reportValidity: () => true,
      setFormValue: () => {},
      setValidity: () => {},
    } as unknown as ElementInternals;
  };
}

// Register the components under test as custom elements. The custom-elements build has no loader to
// call: importing a component entry defines that component and everything it renders - including
// the wa-* elements the component imports for itself, which do get upgraded here.
import './dist/components/ogm-alerts.js';
import './dist/components/ogm-attributes.js';
import './dist/components/ogm-image.js';
import './dist/components/ogm-layers.js';
import './dist/components/ogm-map.js';
import './dist/components/ogm-menubar.js';
import './dist/components/ogm-metadata.js';
import './dist/components/ogm-overview.js';
import './dist/components/ogm-preview.js';
import './dist/components/ogm-previews.js';

// Stand in for the mark that bootstrapLazy() would have set. Dev builds compile in Stencil's
// profiling hooks, and appDidLoad measures against "st:app:start" - but only the lazy loader ever
// marks it, so under this output target every component load rejects with "the mark has not been
// set". Harmless in itself, but vitest counts unhandled rejections and fails the run over them.
// Production builds drop the profiling code entirely, so this is a test-only gap.
performance.mark('st:app:start');

// Used to intercept requests for fixture data in tests
const crossOrigin = (url: string | URL): boolean => {
  try {
    return new URL(String(url), window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
};

// Auto-reject cross-origin fetch requests to keep the test DOM off the network
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' || input instanceof URL ? input : input.url;
  return crossOrigin(url) ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(input, init);
}) as typeof globalThis.fetch;

// Same thing but for XMLHttpRequest; we check at open() and block at send()
const blocked = new WeakMap<XMLHttpRequest, string>();
const realOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  if (crossOrigin(url)) blocked.set(this, String(url));
  else blocked.delete(this);
  return realOpen.call(this, method, url, ...(rest as []));
};

const realSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const url = blocked.get(this);
  if (url) throw new DOMException(`Blocked a request to "${url}": the test DOM has no server behind it.`, 'NetworkError');
  return realSend.call(this, body);
};

export {};

// Note: this reads the built output, so `npm run build` has to have run first.
