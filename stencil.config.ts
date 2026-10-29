import { existsSync } from 'node:fs';

import { Config } from '@stencil/core';

const WORKER_SOURCE_MODULE = 'src/lib/decoder-worker-source.ts';
const WORKER_ENTRY = 'decoder-worker.ts';

const MAPLIBRE_WORKER_SOURCE_MODULE = 'src/lib/maplibre-worker-source.ts';
const MAPLIBRE_WORKER_ENTRY = 'maplibre-gl/dist/maplibre-gl-worker.mjs';

const MAPLIBRE_WORKER_FILE = 'maplibre-gl-worker.mjs';
const MAPLIBRE_WORKER_MARKER = '//# sourceURL=maplibre-gl-worker.js';

// Remove the unpublished worker URL so consuming bundlers do not try to resolve a missing file.
const UPSTREAM_POOL_MODULE = '@developmentseed/geotiff/dist/pool/pool.js';
const UPSTREAM_WORKER_FACTORY = 'createWorker: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" })';
const MISSING_WORKER_URL = './worker.js';

// Use the ES build to avoid a Node-only url import; older LERC copies may have no ES build.
const LERC_MODULE = 'lerc';
const LERC_COMMONJS = 'LercDecode.js';
const LERC_MODULE_BUILD = 'LercDecode.es.js';

const normalize = (id: string) => id.replace(/\\/g, '/');

type Resolver = {
  resolve(source: string, importer: string | undefined, options: { skipSelf: boolean }): Promise<{ id: string } | null>;
};

// Cache across output targets; restart watch mode after editing a worker entry.
let bundledWorker: Promise<string> | undefined;
let bundledMaplibreWorker: Promise<string> | undefined;

// Inline codecs because blob workers cannot resolve sibling chunks; the LZW codec uses top-level await.
async function bundleDecoderWorker(entry: string): Promise<string> {
  const { rolldown } = await import('rolldown');

  const bundle = await rolldown({
    input: entry,
    platform: 'browser',
    // LERC references a Node-only module in an unused branch; leave it unresolved in the browser build.
    external: ['module'],
    // Keep the worker message handler, which the package incorrectly marks as side-effect free.
    treeshake: { moduleSideEffects: () => true },
  });

  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: true });
    return `${output[0].code}\n//# sourceURL=ogm-decoder-worker.js\n`;
  } finally {
    await bundle.close();
  }
}

const inlineDecoderWorker = () => ({
  name: 'ogm-inline-decoder-worker',
  async transform(_code: string, id: string) {
    if (!normalize(id).endsWith(WORKER_SOURCE_MODULE)) return null;

    bundledWorker ??= bundleDecoderWorker(normalize(id).replace(/[^/]+$/, WORKER_ENTRY));
    return { code: `export const DECODER_WORKER_SOURCE = ${JSON.stringify(await bundledWorker)};`, map: { mappings: '' } };
  },
});

// An import-free IIFE supports MapLibre's fallback to classic workers in sandboxed iframes.
async function bundleMaplibreWorker(entry: string): Promise<string> {
  const { rolldown } = await import('rolldown');

  const bundle = await rolldown({ input: entry, platform: 'browser' });

  try {
    // Name the unused default export so Rolldown can emit an IIFE without a warning.
    const { output } = await bundle.generate({ format: 'iife', name: 'maplibreWorker', codeSplitting: false, minify: true });

    // The worker must register its handler; tree shaking can otherwise leave a script that answers nothing.
    if (!/self\.worker\s*=\s*new/.test(output[0].code)) {
      throw new Error(`The bundled MapLibre worker no longer hands itself to \`self\`. Check what maplibre-gl ships now, and update stencil.config.ts.`);
    }

    return `${output[0].code}\n${MAPLIBRE_WORKER_MARKER}\n`;
  } finally {
    await bundle.close();
  }
}

const inlineMaplibreWorker = () => ({
  name: 'ogm-inline-maplibre-worker',
  async transform(this: Resolver, _code: string, id: string) {
    if (!normalize(id).endsWith(MAPLIBRE_WORKER_SOURCE_MODULE)) return null;

    const resolved = await this.resolve(MAPLIBRE_WORKER_ENTRY, id, { skipSelf: true });

    if (!resolved) {
      throw new Error(`Could not resolve \`${MAPLIBRE_WORKER_ENTRY}\`. Check what maplibre-gl ships now, and update stencil.config.ts.`);
    }

    bundledMaplibreWorker ??= bundleMaplibreWorker(resolved.id);
    return { code: `export const MAPLIBRE_WORKER_SOURCE = ${JSON.stringify(await bundledMaplibreWorker)};`, map: { mappings: '' } };
  },
});

const resolveLercAsModule = () => ({
  name: 'ogm-resolve-lerc-as-module',
  async resolveId(this: Resolver, source: string, importer: string | undefined, options: { skipSelf: boolean }) {
    if (source !== LERC_MODULE) return null;

    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved) return null;

    if (normalize(resolved.id).endsWith(`/${LERC_MODULE_BUILD}`)) return resolved;

    if (!normalize(resolved.id).endsWith(`/${LERC_COMMONJS}`)) {
      throw new Error(
        `Expected \`${LERC_MODULE}\` to resolve to ${LERC_COMMONJS} or ${LERC_MODULE_BUILD}, and it resolved to ${resolved.id}. Check what it ships now, and update stencil.config.ts.`,
      );
    }

    const moduleBuild = `${resolved.id.slice(0, -LERC_COMMONJS.length)}${LERC_MODULE_BUILD}`;
    return existsSync(moduleBuild) ? { ...resolved, id: moduleBuild } : resolved;
  },
});

const stripUpstreamDecoderWorker = () => ({
  name: 'ogm-strip-upstream-decoder-worker',
  transform(code: string, id: string) {
    if (!normalize(id).endsWith(UPSTREAM_POOL_MODULE)) return null;

    if (!code.includes(UPSTREAM_WORKER_FACTORY)) {
      throw new Error(`${UPSTREAM_POOL_MODULE} no longer contains the worker factory this build replaces. Check whether it still needs replacing, and update stencil.config.ts.`);
    }

    return { code: code.replace(UPSTREAM_WORKER_FACTORY, 'createWorker: undefined'), map: { mappings: '' } };
  },
});

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

const verifyMaplibreWorkerInlined = () => ({
  name: 'ogm-verify-maplibre-worker-inlined',
  generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
    const chunks = Object.values(bundle).filter(output => output.type === 'chunk' && output.code);
    const carriesMapLibre = chunks.some(chunk => chunk.code?.includes(MAPLIBRE_WORKER_FILE));
    if (!carriesMapLibre || chunks.some(chunk => chunk.code?.includes(MAPLIBRE_WORKER_MARKER))) return;

    throw new Error(`MapLibre is in this bundle and its worker is not. Check that ${MAPLIBRE_WORKER_SOURCE_MODULE} is still where stencil.config.ts looks for it.`);
  },
});

export const config: Config = {
  namespace: 'ogm-viewer',
  rollupPlugins: {
    before: [resolveLercAsModule(), inlineDecoderWorker(), inlineMaplibreWorker(), stripUpstreamDecoderWorker(), verifyNoMissingWorker(), verifyMaplibreWorkerInlined()],
  },
  // The validator expects index.js, but this package registers elements through the component entry.
  validatePrimaryPackageOutputTarget: false,
  buildDist: true,
  outputTargets: [
    // Emit ESM because the wasm decoder uses top-level await, which CommonJS cannot represent.
    {
      type: 'dist-custom-elements',
      generateTypeDeclarations: true,
      // Clear helpers emitted during tests so they cannot leak into the published package.
      empty: true,
      customElementsExportBehavior: 'auto-define-custom-elements',
      // Include the Stencil runtime so browser script imports need no bare-module resolver.
      externalRuntime: false,
    },
    {
      type: 'www',
      serviceWorker: null,
      copy: [{ src: '../assets', dest: 'build/assets' }],
    },
  ],
};
