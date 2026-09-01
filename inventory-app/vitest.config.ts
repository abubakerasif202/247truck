import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/load-env.ts', './tests/setup.ts'],
    // Playwright owns browser acceptance specs; Vitest only collects unit and
    // local-Supabase integration tests when `npm test` is used.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    // Integration tests share one local Postgres; run test files serially so a
    // concurrency test is never perturbed by another file's load.
    fileParallelism: false,
  },
});
