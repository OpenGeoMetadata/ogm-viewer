import { Config } from '@stencil/core';
import nodePolyfills from 'rollup-plugin-node-polyfills';

export const config: Config = {
  namespace: 'ogm-viewer',
  validatePrimaryPackageOutputTarget: true,
  outputTargets: [
    // This is the build target used by apps that will consume the viewer.
    {
      type: 'dist-custom-elements',
      isPrimaryPackageOutputTarget: true,
      copy: [{ src: '../assets', dest: 'assets' }],
    },
    // This target is used for the GitHub Pages preview site.
    {
      type: 'www',
      copy: [{ src: '../assets', dest: 'build/assets' }],
    },
  ],
  rollupPlugins: {
    after: [nodePolyfills()],
  },
  testing: {
    browserHeadless: 'shell',
  },
};
