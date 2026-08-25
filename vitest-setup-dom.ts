// What any of our components need of the DOM they are tested in, whichever build they came out of:
// the gaps happy-dom leaves, and a guarantee that nothing under test reaches the network. Shared by
// the component project (vitest-setup.ts, which drives dist/components) and the www project (which
// drives the built lazy bundle), since neither concern has anything to do with the output target.

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

// Used to intercept requests for fixture data in tests
const crossOrigin = (url: string | URL): boolean => {
  try {
    const resolved = new URL(String(url), window.location.href);
    // Every icon in the library is a data URL - see registerIconLibrary in src/lib/init.ts. Nothing
    // leaves the page for one, so there is nothing here to block, and its origin reads as null.
    if (resolved.protocol === 'data:') return false;
    return resolved.origin !== window.location.origin;
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
