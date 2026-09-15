import tseslint from 'typescript-eslint';

/**
 * The fold's seams are reached through one door. Matches `./fold/apply.js`,
 * `../fold/release.js` and any deeper climb, and not `./folding.js`.
 */
const FOLD_MODULE = String.raw`(^|/)fold/`;

/** The same, with the barrel itself carved out — `events.ts`'s one import. */
const FOLD_MODULE_BUT_BARREL = String.raw`(^|/)fold/(?!index\.js$)`;

const FOLD_DOOR =
  'The fold is reached through one door: events.ts re-exports ./fold/index.js and ' +
  'index.ts publishes it from there. A module that needs a fold helper either belongs ' +
  'in packages/engine/src/fold/, or should be reading state rather than folding it.';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'packages/srd/raw/**',
      // Builders' worktrees are separate checkouts; linting them from here is wrong.
      '.claude/worktrees/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The rules engine is pure and deterministic by contract: same seed and
    // same event log must always fold to a byte-identical GameState. Ambient
    // randomness or clock reads would silently break replay, so they are
    // banned here rather than left to review.
    files: ['packages/engine/**/*.ts'],
    ignores: ['packages/engine/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded PRNG in @ir/engine dice.ts — Math.random breaks replay determinism.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The engine must not read the clock. Pass timestamps in on the event.',
        },
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'Ids must be derived deterministically or supplied by the caller.',
        },
      ],
    },
  },
  {
    // `events.ts` re-exports `./fold/index.js` and that barrel is the whole of
    // what the fold publishes; a module reaching a seam directly would make
    // `export` and `public` the same word again, which is the thing the split
    // was for. Tests are exempt on purpose: `fold-partition.test.ts` proves
    // the partition by importing each seam's own event list, and a dozen more
    // reach in for `spellOn` — widening the barrel to buy a lint rule would
    // cost more than the rule is worth. The zone governs the shipped import
    // graph. Both halves are tested in `fold-import-boundary.test.ts`.
    files: ['packages/engine/**/*.ts'],
    ignores: ['packages/engine/src/fold/**', 'packages/engine/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: FOLD_MODULE, message: FOLD_DOOR }] }],
    },
  },
  {
    // The exception, and it is exactly the door — the barrel, not the
    // directory. This block follows the one above and replaces its pattern.
    files: ['packages/engine/src/events.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: FOLD_MODULE_BUT_BARREL, message: FOLD_DOOR }] },
      ],
    },
  },
);
