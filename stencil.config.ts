import { existsSync } from 'node:fs';

import { Config } from '@stencil/core';

// The worker that decodes COG tiles off the main thread, and the module its bundled source is
// inlined into - siblings, so the entry is found from whichever id Rollup hands us rather than from
// anything relative to the working directory. See src/lib/decoder.ts for why the workers start from
// a string rather than from a file beside this bundle. Ids are matched with their separators
// normalized, so this holds on Windows too.
const WORKER_SOURCE_MODULE = 'src/lib/decoder-worker-source.ts';
const WORKER_ENTRY = 'decoder-worker.ts';

// Upstream's own default pool builds a worker from a URL beside whichever chunk it lands in:
//
//   createWorker: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
//
// COGLayer reaches for that pool whenever it isn't handed one, so the expression is in the bundle
// whether or not anything calls it - and no worker.js is published beside the chunks, so a consumer
// on Vite can't build at all: its worker-import-meta-url plugin resolves the URL as a worker entry
// while transforming the chunk and stops at a file that isn't there. Replacing the factory with
// `undefined` leaves defaultDecoderPool() working, just on the main thread, and takes the URL out of
// the published output. The pool this library actually uses is built in src/lib/decoder.ts.
//
// See: https://github.com/OpenGeoMetadata/ogm-viewer/issues/186
// See: https://github.com/developmentseed/deck.gl-raster/issues/364
const UPSTREAM_POOL_MODULE = '@developmentseed/geotiff/dist/pool/pool.js';
const UPSTREAM_WORKER_FACTORY = 'createWorker: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" })';
const MISSING_WORKER_URL = './worker.js';

// lerc ships two builds of itself, and left alone Rollup takes the wrong one. Its package.json names
// the CommonJS build in both `main` and `browser`, and its exports map's `default` condition is that
// same file - so unless the `import` condition is asked for, a bare `lerc` resolves there. Converted
// back into an ES module, that build carries a static `import "url"` out of the branch it takes under
// Node, and no browser can resolve a bare `url`: the chunk it lands in throws the moment anything
// imports it, which is every attempt to decode a LERC tile on the main thread, and it puts a Node
// builtin into published output where a consumer's bundler has to deal with it too. The ES build is
// the same library with none of that. Only the main-thread bundles need this; the decoder worker is
// bundled by Rolldown, which asks for `import` and gets the right file on its own.
//
// Not every copy in the tree is that package, though: geotiff.js carries a lerc 3 of its own, which
// is one plain UMD file and has no ES build to be sent to. Whether the sibling is there is the test,
// rather than which copy it looks like - the answer is the same either way, and only one of them
// needs asking.
const LERC_MODULE = 'lerc';
const LERC_COMMONJS = 'LercDecode.js';
const LERC_MODULE_BUILD = 'LercDecode.es.js';

const normalize = (id: string) => id.replace(/\\/g, '/');

// The sliver of Rollup's plugin context the plugin below needs. Declared rather than imported: Rollup
// is not a dependency of this package, since Stencil carries its own copy.
type Resolver = {
  resolve(source: string, importer: string | undefined, options: { skipSelf: boolean }): Promise<{ id: string } | null>;
};

// Bundled once per process and reused: every output target runs its own Rollup build, and there is
// nothing in the worker to rebuild between them. A watch session that edits WORKER_ENTRY itself
// needs restarting, which is a fair trade for a file that is one import.
let bundledWorker: Promise<string> | undefined;

// Bundle WORKER_ENTRY into one self-contained ES module, with its dynamically imported codecs
// inlined: a worker started from a blob URL has no directory to resolve a sibling chunk against, so
// anything left unbundled would be unreachable. ES rather than IIFE because
// @developmentseed/lzw-tiff-decoder initializes its wasm with top-level await - see the note on the
// output targets below - though Rolldown hoists that into the lazy initializer it wraps an inlined
// dynamic import in, which is what lets a consumer's bundler re-bundle this file as an IIFE.
async function bundleDecoderWorker(entry: string): Promise<string> {
  const { rolldown } = await import('rolldown');

  const bundle = await rolldown({
    input: entry,
    platform: 'browser',
    // lerc reaches for node:module in the branch it takes outside a browser. Nothing evaluates it
    // here, but left to resolve it Rolldown reports a module it couldn't find.
    external: ['module'],
    // @developmentseed/geotiff declares itself side-effect free, and the worker's message handler is
    // nothing but a side effect: shaken, this bundle comes out empty, and every tile would then wait
    // forever on a worker that registered no listener.
    treeshake: { moduleSideEffects: () => true },
  });

  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: true });
    // Named so devtools lists the worker by something other than its blob URL
    return `${output[0].code}\n//# sourceURL=ogm-decoder-worker.js\n`;
  } finally {
    await bundle.close();
  }
}

// Replaces the empty placeholder in WORKER_SOURCE_MODULE with the bundled worker
const inlineDecoderWorker = () => ({
  name: 'ogm-inline-decoder-worker',
  async transform(_code: string, id: string) {
    if (!normalize(id).endsWith(WORKER_SOURCE_MODULE)) return null;

    bundledWorker ??= bundleDecoderWorker(normalize(id).replace(/[^/]+$/, WORKER_ENTRY));
    return { code: `export const DECODER_WORKER_SOURCE = ${JSON.stringify(await bundledWorker)};`, map: { mappings: '' } };
  },
});

// Sends `lerc` to its ES build rather than the CommonJS one Rollup would otherwise pick; see
// LERC_MODULE above for why. Resolution is left to whoever would have done it and the answer
// redirected, so nothing here has to know where the package was installed.
const resolveLercAsModule = () => ({
  name: 'ogm-resolve-lerc-as-module',
  async resolveId(this: Resolver, source: string, importer: string | undefined, options: { skipSelf: boolean }) {
    if (source !== LERC_MODULE) return null;

    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved) return null;

    // Already there - a newer lerc whose exports map answers `browser` with the ES build, say - and
    // this plugin has nothing left to do.
    if (normalize(resolved.id).endsWith(`/${LERC_MODULE_BUILD}`)) return resolved;

    // Loudly rather than quietly, as with the worker factory above: a package laid out differently
    // must not be left on a build that cannot load in a browser without anyone noticing.
    if (!normalize(resolved.id).endsWith(`/${LERC_COMMONJS}`)) {
      throw new Error(
        `Expected \`${LERC_MODULE}\` to resolve to ${LERC_COMMONJS} or ${LERC_MODULE_BUILD}, and it resolved to ${resolved.id}. Check what it ships now, and update stencil.config.ts.`,
      );
    }

    const moduleBuild = `${resolved.id.slice(0, -LERC_COMMONJS.length)}${LERC_MODULE_BUILD}`;
    return existsSync(moduleBuild) ? { ...resolved, id: moduleBuild } : resolved;
  },
});

// Takes upstream's worker URL out of the bundle; see UPSTREAM_POOL_MODULE above for why
const stripUpstreamDecoderWorker = () => ({
  name: 'ogm-strip-upstream-decoder-worker',
  transform(code: string, id: string) {
    if (!normalize(id).endsWith(UPSTREAM_POOL_MODULE)) return null;

    // Loudly rather than quietly: a version of the package that words this differently would
    // otherwise put the URL back in the published bundle and break every consumer on Vite again.
    if (!code.includes(UPSTREAM_WORKER_FACTORY)) {
      throw new Error(`${UPSTREAM_POOL_MODULE} no longer contains the worker factory this build replaces. Check whether it still needs replacing, and update stencil.config.ts.`);
    }

    return { code: code.replace(UPSTREAM_WORKER_FACTORY, 'createWorker: undefined'), map: { mappings: '' } };
  },
});

// The other half of that: nothing may reach the published output asking for a worker.js beside it,
// however it got there. Cheap enough to check on every build, and the failure it catches is one that
// only shows up in someone else's build log.
const verifyNoMissingWorker = () => ({
  name: 'ogm-verify-no-missing-worker',
  generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
    const referenced = Object.entries(bundle).filter(([, output]) => output.type === 'chunk' && output.code?.includes(MISSING_WORKER_URL));
    if (referenced.length === 0) return;

    throw new Error(
      `${MISSING_WORKER_URL} is not published by this package, and is asked for by ${referenced.map(([fileName]) => fileName).join(', ')}. See https://github.com/OpenGeoMetadata/ogm-viewer/issues/186.`,
    );
  },
});

export const config: Config = {
  namespace: 'ogm-viewer',
  rollupPlugins: {
    before: [resolveLercAsModule(), inlineDecoderWorker(), stripUpstreamDecoderWorker(), verifyNoMissingWorker()],
  },
  // Off because the check wants package.json's `module`/`types` pointed at dist/components/index.js,
  // and for this output target that file is the Stencil runtime, not a barrel - importing it defines
  // no elements at all. The component entries are what register the library, so package.json names
  // dist/components/ogm-viewer.js instead, and the validator has no way to be told that.
  validatePrimaryPackageOutputTarget: false,
  buildDist: true, // Always build all targets
  outputTargets: [
    // This is the build target used by apps that will consume the viewer. It emits ESM only, which
    // the `dist` target does not: `dist` also renders a CommonJS copy, and CommonJS cannot represent
    // the top-level await that @developmentseed/lzw-tiff-decoder uses to initialize its wasm module.
    // That is what kept the deck.gl COG previewer - the only one that can warp a COG that is not in
    // Web Mercator - out of the build. See https://github.com/OpenGeoMetadata/ogm-viewer/issues/100
    //
    // Importing any component entry still defines every element in the library, so embedding is
    // unchanged: one script tag, or one bare import, and <ogm-viewer> works.
    {
      type: 'dist-custom-elements',
      generateTypeDeclarations: true,
      // Without this Stencil generates a bunch of helpers like index2.js in dist/ during tests
      // and they don't get removed on build, which means they can inadvertently end up in
      // the npm package. This ensures we don't accidentally ship them.
      empty: true,
      customElementsExportBehavior: 'auto-define-custom-elements',
      // Bundle the Stencil runtime rather than leaving bare `@stencil/core/*` specifiers behind.
      // Without this a browser loading us from a script tag has nothing to resolve them against.
      externalRuntime: false,
      // Nothing is copied beside the bundle. Everything a component needs at runtime - Web Awesome's
      // theme, our icons - is compiled into it by scripts/inline-assets.mjs, because an app that
      // bundles us carries the JavaScript it imported and knows nothing of a directory beside it.
    },
    // This target is used for the GitHub Pages preview site.
    {
      type: 'www',
      serviceWorker: null,
      // The demo page's own furniture - its favicon and the records it offers to preview. What the
      // components themselves need is in the bundle, as above.
      copy: [{ src: '../assets', dest: 'build/assets' }],
    },
  ],
};
