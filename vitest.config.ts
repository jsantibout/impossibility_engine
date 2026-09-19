import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Tests run against package *source*, not built output, so `npm test` never
  // needs a prior `tsc -b`. Production builds still resolve through dist.
  resolve: {
    alias: {
      '@ie/shared': pkg('shared'),
      '@ie/srd': pkg('srd'),
      '@ie/engine': pkg('engine'),
      '@ie/content': pkg('content'),
      '@ie/tools': pkg('tools'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/scripts/**/*.test.ts',
      // The LLM probe is an experiment, not a package, but its harness is
      // tested offline for the same reason everything else is.
      'tools/*/src/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/generated/**', '**/index.ts'],
    },
  },
});
