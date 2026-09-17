import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const testEnvironmentKeys = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_ALLOW_DESTRUCTIVE',
] as const;

const localEnvironment = loadEnv('test', process.cwd(), '');
const testEnvironment = Object.fromEntries(
  testEnvironmentKeys
    .filter((key) => Boolean(localEnvironment[key]))
    .map((key) => [key, localEnvironment[key]]),
);

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
    // Suite-level environment guards run while test modules are evaluated,
    // before setupFiles. Supply the local disposable Supabase credentials to
    // every worker at startup, while allowing explicit process env to win.
    env: testEnvironment,
    environment: 'jsdom',
    setupFiles: ['./tests/load-env.ts', './tests/setup.ts'],
    // Playwright owns browser acceptance specs; Vitest only collects unit and
    // local-Supabase integration tests when `npm test` is used.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    // Integration tests share one local Postgres; run test files serially so a
    // concurrency test is never perturbed by another file's load.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'lib/integrations/adelaide-auth.ts',
        'lib/integrations/adelaide-route.ts',
        'lib/integrations/cron-auth.ts',
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
    },
  },
});
