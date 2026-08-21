/**
 * Shared ESLint base for every workspace package.
 *
 * Deliberately small. The architectural rules that matter live in
 * `apps/api/.dependency-cruiser.cjs`, because they are properties of the resolved
 * dependency GRAPH and ESLint can only see one import string at a time. See
 * docs/engineering/04-boundaries-and-enforcement.md for why both exist.
 */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

    /*
     * `import type` must be spelled as such. tsconfig sets verbatimModuleSyntax, so a value
     * import of a type-only symbol is an ERROR at build time rather than a nuisance — this
     * rule surfaces it in the editor instead of in CI.
     */
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],

    /*
     * Money is integer paise everywhere (docs/README.md §Conventions). A float creeping into
     * a fare calculation is a rounding bug that shows up on a customer's receipt weeks later,
     * so the paise convention is enforced by naming: every amount field ends in `_paise` or
     * `Paise`. This rule cannot check that, but it stops the most common way a float arrives.
     */
    'no-restricted-globals': [
      'error',
      { name: 'parseFloat', message: 'Money is integer paise. Use parseInt or Number.' },
    ],

    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: ['dist', '.next', 'node_modules', 'coverage', '*.config.js'],
};
