import { getBasePath, registerIconLibrary, setBasePath } from '@awesome.me/webawesome';

// Where this library's own files live. Anchored to this module's URL rather than to Stencil's asset
// path: the custom-elements build starts that path empty, so it would resolve against the embedding
// page rather than against us, and every icon and the Web Awesome theme would 404 on any host that
// doesn't happen to serve our assets at its own root. Stencil's setAssetPath() is not usable from
// inside the library either - the compiler rewires getAssetPath() into component bundles but leaves
// setAssetPath as a bare global reference, so calling it here throws at load. Reading import.meta.url
// asks the only question that actually matters, and holds whether we're loaded from a CDN, from a
// host's own assets, or from a dev server.
setBasePath(new URL('.', import.meta.url).href);

// Serve icons from our self-hosted bootstrap-icons subset instead of the default Font Awesome library
registerIconLibrary('default', {
  resolver: name => getBasePath(`assets/icons/${name}.svg`),
});

// The Web Awesome theme, which components link inside their own shadow root rather than at the top
// of the page: loading it into the document would restyle the host app around us.
export const webAwesomeStylesheet = (): string => getBasePath('assets/webawesome/styles/themes/default.css');
