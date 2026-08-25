import type { NextConfig } from 'next';

const config: NextConfig = {
  // standalone traces only the files the server actually loads, which is what keeps the
  // production image small in a monorepo. See apps/web/Dockerfile.
  output: 'standalone',
  // The monorepo root, so tracing follows the workspace packages rather than stopping at
  // apps/web and shipping an image missing half its imports.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // The workspace packages ship TypeScript source, not a build. Next compiles them itself.
  transpilePackages: ['@driverzone/design-system', '@driverzone/contracts', '@driverzone/geo'],
  reactStrictMode: true,

  webpack(webpackConfig) {
    /*
     * `@driverzone/geo` and `@driverzone/contracts` compile under NodeNext, where a relative
     * import from a .ts source carries a `.js` extension — `export * from './coords.js'`.
     * That is correct and required for `apps/api`, which runs them as real ESM.
     *
     * Webpack resolves that literally, looks for a `coords.js` that does not exist on disk,
     * and fails the build with "Module not found" pointing at a file that is plainly there
     * as `coords.ts`. `extensionAlias` is the standard answer: try the TypeScript sources
     * first, fall back to a real .js.
     *
     * `@driverzone/design-system` does not need this — it compiles with
     * `moduleResolution: Bundler` (packages/config/tsconfig.react.json), where extensionless
     * relative imports are correct.
     */
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      ...(webpackConfig.resolve.extensionAlias ?? {}),
    };
    return webpackConfig;
  },
};

export default config;
