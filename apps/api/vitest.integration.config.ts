import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests — the ones that need a real Mongo and Redis.
 *
 * Separate from `vitest.config.ts` so `pnpm test` stays fast and runnable with nothing running.
 * Start the dependencies first:
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   pnpm --filter @driverzone/api test:integration
 *
 * See docs/engineering/10-testing.md.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    // A real database is slower than a fake, and a timeout here reads as a flaky test rather
    // than the connection problem it usually is.
    testTimeout: 20_000,
    // Shared database state cannot be written by two files at once.
    fileParallelism: false,
  },
});
