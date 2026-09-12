import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Upgrade-from-baseline harness config. Mirrors vitest.config.ts but only
 * collects tests/upgrade/**, which straddle a `supabase db reset` + a
 * migration being applied mid-run (see scripts/verify-migration-upgrade.sh).
 * Never included by the ordinary `npm test` run.
 */
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
    include: ['tests/upgrade/**/*.test.ts'],
    fileParallelism: false,
  },
});
