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
    // Integration tests share one local Postgres; run test files serially so a
    // concurrency test is never perturbed by another file's load.
    fileParallelism: false,
  },
});
