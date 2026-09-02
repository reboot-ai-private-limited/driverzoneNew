import { readFileSync } from 'node:fs';
import esbuild from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * What stays external, and why the distinction matters.
 *
 * THIRD-PARTY deps stay external. mongoose and bullmq do dynamic resolution a bundler cannot
 * follow, and `pnpm deploy --prod` copies a real node_modules tree into the image anyway.
 *
 * The `@driverzone/*` WORKSPACE packages must be BUNDLED. They publish TypeScript source
 * (`exports: "./src/index.ts"`) rather than a build, so leaving them external means the
 * runtime tries to `import` a .ts file from inside node_modules — and Node refuses:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *   Stripping types is currently unsupported for files under node_modules
 *
 * That failure does not appear at build time. The image builds, the layers look right, and the
 * container crashes on its first line. `--packages=external` marks everything external and
 * cannot be selectively undone, so the external list is enumerated instead.
 */
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@driverzone/'));

await esbuild.build({
  /**
   * Three entrypoints, three composition roots. `seed.ts` is here so a DEPLOYED stack can be
   * seeded — the runtime image carries `dist/` and production node_modules, with no `tsx` and no
   * TypeScript to run `src/scripts/seed.ts` with. It lands at `dist/scripts/seed.js` — esbuild
   * mirrors each entrypoint's path below the common ancestor, so it does NOT sit beside
   * server.js. See the `seed` service in docker-compose.prod.yml; it refuses to run unless
   * STAGING_UNSAFE is set.
   */
  entryPoints: ['src/server.ts', 'src/worker.ts', 'src/scripts/seed.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist',
  sourcemap: true,
  external,
  logLevel: 'info',
});
