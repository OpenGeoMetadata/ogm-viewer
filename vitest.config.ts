import { defineVitestConfig } from '@stencil/vitest/config';

export default defineVitestConfig({
  stencilConfig: './stencil.config.ts',
  test: {
    projects: [
      // Unit tests - node environment for functions / logic
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Component tests that use a node-based DOM
      {
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          environment: 'happy-dom',
          environmentOptions: {
            happyDOM: {
              settings: {
                fetch: { virtualServers: [{ url: /^https?:\/\/[^/]+\/.*\/assets(?=\/)/, directory: './dist/components/assets' }] },
              },
            },
          },
          setupFiles: ['./vitest-setup.ts'],
        },
      },
    ],
  },
});
