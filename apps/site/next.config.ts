import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

/**
 * Deliberately much smaller than `apps/web/next.config.ts`, and the differences are the point.
 *
 * NO `transpilePackages`. The panel compiles `@driverzone/contracts` and `@driverzone/geo` from
 * TypeScript source and needs a webpack `extensionAlias` to survive their NodeNext `.js`
 * specifiers. This site talks to no API and imports no workspace package, so none of that
 * machinery applies — and adding it "to match" would couple a brochure site to the release
 * cycle of the contracts package for no benefit.
 *
 * `output: 'standalone'` is kept, because the deployment story is the same one: a small image
 * that traces only what the server loads.
 */
const config: NextConfig = {
  output: 'standalone',
  // The monorepo root, so tracing follows the workspace rather than stopping at apps/site.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  reactStrictMode: true,
  images: {
    // Retina devices request 2× — make sure 2× widths are in the srcset.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default config;
