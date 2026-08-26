/**
 * Shared ESLint config for the React packages — `apps/web`, `packages/design-system`,
 * `packages/mobile-ui`, and the two Expo apps.
 *
 * Mirrors the `tsconfig.base` / `tsconfig.react` split already in this package: the base is
 * everything every package needs, this adds what only a React codebase can use. Keeping them
 * apart matters because `apps/api` must not load a React plugin to lint an Express controller.
 *
 * Extend it INSTEAD of the base, not alongside it — this file extends the base itself.
 */
module.exports = {
  extends: [
    require.resolve('./eslint.base.cjs'),
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'prettier',
  ],
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  settings: { react: { version: 'detect' } },
  parserOptions: { ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
  rules: {
    // React 19 with the automatic JSX runtime — importing React to use JSX has not been
    // required since 17, and `verbatimModuleSyntax` makes an unused one an error anyway.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',

    /*
     * An index key silently reuses DOM state across a reorder — the classic symptom is text
     * typed into row 2 appearing in row 5 after a sort. A handful of places here are genuinely
     * positional (OTP digit boxes, skeleton rows) and disable it inline with a reason.
     */
    'react/no-array-index-key': 'error',

    /*
     * The dependency array is where a stale closure lives, and a stale closure in the session
     * refresh timer means a token that never renews. Error, not warn: a warning in a list of
     * warnings is not a rule.
     */
    'react-hooks/exhaustive-deps': 'error',

    /*
     * The accessibility claims in docs/engineering/design-language.md — the nav expanding on
     * focus-within, icon-only buttons carrying a label, labels wired to their controls — are
     * only true while something checks them. This is that something.
     */
    'jsx-a11y/no-autofocus': 'off', // the OTP screen has exactly one thing to do
  },
};
