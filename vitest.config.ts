import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const subpath = (name: string, file: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/${file}.ts`, import.meta.url));

export default defineConfig({
  // Tests run against package *source*, not built output, so `npm test` never
  // needs a prior `tsc -b`. Production builds still resolve through dist.
  resolve: {
    alias: {
      // Subpaths first, and they must be: an alias matches `@ie/srd` and
      // anything under `@ie/srd/`, so the barrel's entry would otherwise
      // rewrite `@ie/srd/schemas` to `…/src/index.ts/schemas`. The package
      // publishes `./schemas` so the engine can validate against a shape
      // without loading the parsed book — see `srd-barrel.test.ts`.
      '@ie/srd/schemas': subpath('srd', 'schemas'),
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
