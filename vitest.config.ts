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
          // The www project's tests end in .test.ts too, but need a DOM and a built bundle
          exclude: ['src/**/*.www.test.ts'],
          environment: 'node',
        },
      },
      // Component tests that use a node-based DOM
      {
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          environment: 'happy-dom',
          setupFiles: ['./vitest-setup.ts'],
        },
      },
      // The lazy build - the one src/index.html and the GitHub Pages preview site load - driven
      // through its own loader, out of www/, rather than compiled here. Nothing else in the suite
      // can see that build: the plugin that compiles a .tsx for a test emits the custom-elements
      // form of a component, and the component project imports dist/components on top of that. So
      // whatever the lazy loader and runtime do differently - and they construct a component
      // differently enough to have broken every one of them once - only these tests can catch.
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
