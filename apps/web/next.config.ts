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
};

export default config;
