const base = require('@driverzone/config/eslint.base.cjs');

/**
 * ESLint is the fast echo of the module boundary; `.dependency-cruiser.cjs` is the authority.
 *
 * `no-restricted-imports` matches the literal source STRING, so it can only catch the aliased
 * spelling of a cross-module reach. It cannot see a relative escape (`../../inbox/domain/x.js`)
 * and it cannot see a cycle at all. It stays because it flags the common case in the editor,
 * seconds after you type it, rather than minutes later in CI.
 */
module.exports = {
  ...base,
  root: true,
  rules: {
    ...base.rules,
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@/modules/*/domain/*',
              '@/modules/*/application/*',
              '@/modules/*/infrastructure/*',
              '@/modules/*/interface/*',
              '@/modules/*/*.container*',
            ],
            message:
              "A module's internals are private. Import its '<name>.public.js' contract instead — " +
              'see docs/engineering/04-boundaries-and-enforcement.md.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      /*
       * `src/routes.ts` is the APPLICATION composition root — the one file whose job is to
       * build every module container and wire the contracts between them. Reaching for a
       * container is the point of it, not a violation.
       *
       * dependency-cruiser needs no equivalent exemption: its rule is scoped to
       * `from: ^src/modules/`, so a file outside a module was never in scope. ESLint's
       * `no-restricted-imports` is a flat glob with no notion of where the importer lives,
       * which is precisely the limitation documented at the top of
       * `.dependency-cruiser.cjs` — the two tools are not redundant.
       */
      files: ['src/routes.ts', 'src/app.ts', 'src/server.ts', 'src/worker.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
