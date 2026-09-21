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
    //
    // **Three of these were written down and six were not**, and the six are
    // the same sentence said in other words: a module reaches them without
    // importing anything, so nothing in a diff shows that a fold has started
    // depending on the host. They are banned in the three shapes the language
    // gives them — a property of a global object, a bare global, and `new` on
    // a constructor — and every one is driven through ESLint in
    // `purity-zone.test.ts`, because a restricted global that ESLint does not
    // resolve is a rule that reports nothing and looks enforced.
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
        {
          object: 'performance',
          property: 'now',
          message:
            'The engine must not read a clock, monotonic or otherwise — a fold that timed itself ' +
            'would not replay. Pass the number in on the event, or measure from outside the engine.',
        },
        {
          object: 'process',
          property: 'env',
          message:
            'The environment is input nobody passed: the engine would fold one way on your machine ' +
            'and another in CI, from a log that says nothing about either. Take it as an argument.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'globalThis',
          message:
            'The engine holds no ambient state. Whatever is on the global object came from outside ' +
            'the event log, so a fold that read it would not replay. Pass it in.',
        },
        {
          name: 'Intl',
          message:
            'Intl formats by the host locale, so the engine would produce different text on ' +
            'different machines from the same log. Format outside the engine.',
        },
        {
          name: 'structuredClone',
          message:
            'A host builtin whose behaviour is the runtime version’s, not this repository’s. ' +
            'The engine copies with the spread it already uses, which is also what the fold expects.',
        },
      ],
      // `Date.now` is a property and is banned above; `new Date()` is the same
      // clock read written as a constructor, and no property ban can see it.
      // The selector is on the `new`, so a `Date` *type* annotation and a
      // parameter somebody named `Date` are untouched.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'The engine must not read the clock. `new Date()` is `Date.now()` with a wrapper: pass ' +
            'the timestamp in on the event, which is the only place replay can find it again.',
        },
      ],
    },
  },
  {
    // The one place the zone above does not reach, named rather than a
    // directory, and with the other eight bans left switched on.
    //
    // `packages/engine/scripts/` is not the engine: nothing in it is compiled
    // into `@ie/engine` (the package builds `src/**/*`), and the instruments
    // there read the disk, print to stdout and time themselves with
    // `process.hrtime` — a benchmark that may not read a clock is not a
    // benchmark. `bench-fold.ts:82` reads `globalThis.__PASS__`, a profiling
    // hook the fold used to set while somebody was measuring it; **nothing in
    // the tree sets it today**, so the readout is inert, and no fold folds
    // differently for it. That is why this is `no-restricted-globals` off for
    // one file rather than the scripts directory excused: `Math.random` and
    // `new Date()` in `make-golden-log.ts` would still be refused, which is
    // the ban that actually matters there.
    files: ['packages/engine/scripts/bench-fold.ts'],
    rules: { 'no-restricted-globals': 'off' },
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
    //
    // Every file, not just the engine's: `@ie/engine` publishes only `.`, so
    // no other package can reach a seam today, and saying so here costs
    // nothing and means the zone matches the sentence it enforces.
    files: ['**/*.ts'],
    ignores: ['packages/engine/src/fold/**', '**/*.test.ts'],
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
