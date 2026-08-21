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
 * the tree walkable at all. See docs/engineering/08-mobile-in-monorepo.md.
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

module.exports = config;
