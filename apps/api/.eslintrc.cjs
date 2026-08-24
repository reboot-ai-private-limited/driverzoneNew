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
    /**
     * Log messages must be static strings; data goes in the object argument.
     *
     * This is a REDACTION rule, not a style rule. pino's `redact` matches object paths — it
     * cannot see inside a string, so `logger.info(`otp ${otp} sent`)` defeats every path in the
     * list and writes a trip-start code to stdout. Enforcing static messages closes the one
     * hole path-based redaction cannot.
     *
     * It also makes logs aggregatable: a static message is a groupable key, an interpolated one
     * is a unique value per request.
     *
     *   bad:   logger.info(`${signal} received`)
     *   good:  logger.info({ signal }, 'signal received')
     */
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='logger'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]",
        message:
          'Log messages must be static — pino redaction cannot see inside a string. ' +
          "Put the value in the object argument: logger.info({ signal }, 'signal received').",
      },
      {
        selector:
          "CallExpression[callee.object.name='logger'][arguments.0.type='BinaryExpression'][arguments.0.operator='+']",
        message:
          'Log messages must be static — pino redaction cannot see inside a string. ' +
          'Put the value in the object argument.',
      },
    ],
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
              'see docs/engineering/boundaries-and-enforcement.md.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      /*
       * `src/container.ts` is the APPLICATION composition root — the one file whose job is to
       * build every module container and wire the contracts between them. Reaching for a
       * container is the point of it, not a violation.
       *
       * `src/routes.ts` is deliberately NOT in this list. It receives containers already built
       * and only mounts their routers, so it needs no module internals — and leaving it
       * unexempted means the boundary rule keeps watching the file most likely to grow a
       * shortcut.
       *
       * dependency-cruiser needs no equivalent exemption: its rule is scoped to
       * `from: ^src/modules/`, so a file outside a module was never in scope. ESLint's
       * `no-restricted-imports` is a flat glob with no notion of where the importer lives,
       * which is precisely the limitation documented at the top of
       * `.dependency-cruiser.cjs` — the two tools are not redundant.
       */
      files: ['src/container.ts', 'src/app.ts', 'src/server.ts', 'src/worker.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
