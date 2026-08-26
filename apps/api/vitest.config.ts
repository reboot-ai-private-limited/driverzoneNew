import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    /**
     * `test/integration/` needs a real Mongo and Redis and is run by
     * `vitest.integration.config.ts` under `pnpm test:integration`. Without this exclude the
     * glob above swallows it and `pnpm test` stops being runnable with nothing started, which
     * is the whole reason the two configs are separate. See docs/engineering/testing.md.
     */
    exclude: ['**/node_modules/**', 'test/integration/**'],
    environment: 'node',
  },
});
