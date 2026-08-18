import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'ogm-viewer',
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
      // Unlike the other output targets, `dest` here is resolved from the project root
      copy: [
        { src: '../assets', dest: 'dist/components/assets' },
        { src: '../node_modules/@awesome.me/webawesome/dist/styles', dest: 'dist/components/assets/webawesome/styles' },
      ],
    },
    // This target is used for the GitHub Pages preview site.
    {
      type: 'www',
      serviceWorker: null,
      copy: [
        { src: '../assets', dest: 'build/assets' },
        { src: '../node_modules/@awesome.me/webawesome/dist/styles', dest: 'build/assets/webawesome/styles' },
      ],
    },
  ],
};
