const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro in a monorepo. Both settings below are required — the app bundles without either in
 * isolation and fails the moment it imports a workspace package.
 *
 * Metro resolves modules by walking real directories upward from the importing file. In a
 * monorepo `@driverzone/contracts` lives outside apps/<app>, so:
 *
 *   watchFolders          tells Metro the repo root is part of the project, so it will both
 *                         resolve files there and pick up edits without a restart. Without it,
 *                         changing a shared package does nothing until you clear the cache.
 *
 *   nodeModulesPaths      tells Metro to look in the ROOT node_modules as well as the app's.
 *                         pnpm installs most packages there; without this the bundle fails
 *                         with "Unable to resolve module react-native", which reads like a
 *                         broken install rather than a resolver configuration problem.
 *
 * The third piece is not here — it is `node-linker=hoisted` in the repo-root `.npmrc`. pnpm's
 * default symlinked layout is not something Metro can follow, and that setting is what makes
 * the tree walkable at all. See docs/engineering/mobile-in-monorepo.md.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The workspace packages ship TypeScript source (`exports: "./src/index.ts"`) rather than a
// build, so Metro must read the exports map to find them.
config.resolver.unstable_enablePackageExports = true;

/**
 * `./http.js` inside `packages/contracts/src/index.ts` means `./http.ts`, and only Metro needs
 * telling.
 *
 * The shared packages are TypeScript compiled under NodeNext, where a relative import MUST carry
 * the `.js` extension it will have after a build even though the file on disk is `.ts`. `tsc` and
 * `tsx` both understand that; Metro takes the specifier literally, finds no `http.js`, and fails
 * with "Unable to resolve ./http.js from packages/contracts/src/index.ts".
 *
 * IT ONLY BITES ON A RUNTIME IMPORT. Every `import type` from a workspace package is erased
 * before Metro sees it, so the app bundled for months while importing contracts purely for
 * types — the first `import { CAR_CATEGORIES }` is what makes Metro actually read the file.
 *
 * SCOPED TO THE WORKSPACE PACKAGES on purpose: inside the app, a `.js` specifier means a real
 * `.js` file and rewriting it would be wrong.
 */
const packagesRoot = path.resolve(workspaceRoot, 'packages');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromPackage = context.originModulePath?.startsWith(packagesRoot) ?? false;
  const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../');

  if (fromPackage && isRelative && moduleName.endsWith('.js')) {
    // Extensionless, so Metro applies its own `sourceExts` and finds the `.ts`. Falls through to
    // the untouched specifier if that misses, which is what a genuine `.js` file there needs.
    try {
      return context.resolveRequest(context, moduleName.slice(0, -'.js'.length), platform);
    } catch {
      // Intentionally ignored — resolve the original specifier below.
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
