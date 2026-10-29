import { defineVitestConfig } from '@stencil/vitest/config';

export default defineVitestConfig({
  stencilConfig: './stencil.config.ts',
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.www.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          environment: 'happy-dom',
          setupFiles: ['./vitest-setup.ts'],
        },
      },
      // Exercise the built lazy loader; component compilation does not cover its initialization behavior.
      {
        test: {
          name: 'www',
          include: ['src/**/*.www.test.ts'],
          environment: 'happy-dom',
          setupFiles: ['./vitest-setup-dom.ts'],
        },
      },
    ],
  },
});
