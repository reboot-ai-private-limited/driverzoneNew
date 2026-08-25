import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Node, not jsdom. What is worth testing here is logic that has no DOM in it — the
    // session's refresh behaviour, error mapping, the formatters. Component snapshots fail on
    // every legitimate change and pass on every regression that does not alter markup.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
