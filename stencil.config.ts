import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'ogm-viewer',
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
    },
    {
      type: 'dist-custom-elements',
      customElementsExportBehavior: 'auto-define-custom-elements',
      externalRuntime: false,
      copy: [
        {
          src: '../node_modules/@shoelace-style/shoelace/dist/assets/icons',
          dest: 'dist/assets/icons',
          warn: true,
        },
      ],
    },
    // This target is used only for the development live server.
    {
      type: 'www',
      serviceWorker: null, // disable service workers
      copy: [
        {
          src: '../node_modules/@shoelace-style/shoelace/dist/assets/icons',
          dest: 'assets/icons',
          warn: true,
        },
      ],
    },
  ],
  testing: {
    browserHeadless: 'shell',
  },
};
