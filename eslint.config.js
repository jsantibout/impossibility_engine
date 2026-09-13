import tseslint from 'typescript-eslint';

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
);
