import { defineVitestConfig } from '@stencil/vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineVitestConfig({
  stencilConfig: './stencil.config.ts',
  test: {
    projects: [
      // Unit tests - node environment for functions / logic
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          environment: 'node',
        },
      },
      // Component tests that use a node-based DOM
      {
        test: {
          name: 'component',
          include: ['src/**/*.spec.tsx'],
          environment: 'stencil',
          setupFiles: ['./vitest-setup.ts'],
        },
      },
      // End-to-end tests in a browser using Playwright
      {
        test: {
          name: 'e2e',
          include: ['test/**/*.test.{ts,tsx}'],
          setupFiles: ['./vitest-setup.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
