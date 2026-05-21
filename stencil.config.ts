import { Config } from '@stencil/core';
import nodePolyfills from 'rollup-plugin-node-polyfills';

export const config: Config = {
  namespace: 'ogm-viewer',
  validatePrimaryPackageOutputTarget: true,
  buildDist: true, // Always build all targets
  outputTargets: [
    // This is the build target used by apps that will consume the viewer.
    {
      type: 'dist-custom-elements',
      isPrimaryPackageOutputTarget: true,
      copy: [{ src: '../assets', dest: 'assets' }],
    },
    // This target is used for the GitHub Pages preview site and browser testing.
    {
      type: 'www',
      serviceWorker: null,
      copy: [
        { src: '../assets', dest: 'build/assets' },
        { src: '../test/fixtures/records', dest: 'build/records' },
      ],
    },
  ],
  rollupPlugins: {
    after: [nodePolyfills()],
  },
};
