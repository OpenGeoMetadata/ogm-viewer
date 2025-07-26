import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'ogm-viewer',
  validatePrimaryPackageOutputTarget: true,
  outputTargets: [
    // This is the build target used by apps that will consume the viewer.
    {
      type: 'dist',
      esmLoaderPath: '../loader',
      isPrimaryPackageOutputTarget: true,
    },
    // This target is used for the GitHub Pages preview site.
    {
      type: 'www',
      serviceWorker: null, // disable service workers
    },
  ],
  testing: {
    browserHeadless: 'shell',
  },
};
