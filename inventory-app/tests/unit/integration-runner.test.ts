// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// The runner's own private.requireDisposableLocalTestEnvironment-style guard
// (see scripts/run-integration-tests.mjs) only validates the *shape* of these
// four values (a localhost/127.0.0.1 URL on port 55331, plus the destructive
// opt-in flag) before it ever spawns vitest — it makes no network call itself.
// This suite never runs real vitest (node_modules/vitest/vitest.mjs is faked
// per-case below), so these values never need to resolve to a real database.
// They are injected into the *spawned subprocess's own env only* — never into
// this test file's own process.env — so the suite is fully self-contained
// and must not depend on a developer's .env.local or any CI-provided secret.
const SAFE_RUNNER_ENV = {
  SUPABASE_TEST_URL: 'http://127.0.0.1:55331',
  SUPABASE_TEST_ANON_KEY: 'unit-test-inert-anon-key',
  SUPABASE_TEST_SERVICE_ROLE_KEY: 'unit-test-inert-service-role-key',
  SUPABASE_TEST_ALLOW_DESTRUCTIVE: 'true',
} as const;

function runReporter(report: Record<string, unknown> | null, stale = false) {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-integration-gate-'));
  directories.push(directory);
  mkdirSync(join(directory, 'node_modules/vitest'), { recursive: true });
  mkdirSync(join(directory, '.test-results'));
  copyFileSync(resolve('scripts/run-integration-tests.mjs'), join(directory, 'runner.mjs'));
  if (stale) writeFileSync(join(directory, '.test-results/integration.json'), JSON.stringify({ numPassedTests: 100 }));
  writeFileSync(join(directory, 'node_modules/vitest/vitest.mjs'), report
    ? `import { writeFileSync } from 'node:fs'; writeFileSync('.test-results/integration.json', ${JSON.stringify(JSON.stringify(report))});`
    : '// Simulate a runner exiting successfully without producing its report.');
  return () => execFileSync(process.execPath, ['runner.mjs'], {
    cwd: directory,
    stdio: 'pipe',
    env: { ...process.env, ...SAFE_RUNNER_ENV },
  });
}

describe('integration process gate', () => {
  it('rejects an absent report despite a zero runner exit', () => {
    expect(runReporter(null)).toThrow();
  });
  it('never accepts a stale successful report', () => {
    expect(runReporter(null, true)).toThrow();
  });
  it('rejects a report with no passing tests', () => {
    expect(runReporter({ numPassedTests: 0 })).toThrow();
  });
  it('rejects skipped database coverage', () => {
    expect(runReporter({ numPassedTests: 10, numPendingTests: 1 })).toThrow();
  });
  it('rejects a report containing failed tests', () => {
    expect(runReporter({ numPassedTests: 9, numFailedTests: 1, numPendingTests: 0, numFailedTestSuites: 0 })).toThrow();
  });
  it('accepts a fresh passing report with zero skipped tests', () => {
    expect(runReporter({ numPassedTests: 10, numFailedTests: 0, numPendingTests: 0, numFailedTestSuites: 0 })).not.toThrow();
  });

  it('accepts a fresh passing report even when no developer-local Supabase env is configured', () => {
    // Regression test for the CI static job (lint/typecheck/unit/build), which
    // intentionally never provisions SUPABASE_TEST_* — only the separate
    // database job does. Strip them from *this test's own* process.env
    // (save/restore, never mutated permanently) to prove runReporter's
    // explicit `env` override — not an ambient .env.local or CI secret — is
    // what satisfies the runner's environment-shape guard.
    const testEnvironmentKeys = [
      'SUPABASE_TEST_URL',
      'SUPABASE_TEST_ANON_KEY',
      'SUPABASE_TEST_SERVICE_ROLE_KEY',
      'SUPABASE_TEST_ALLOW_DESTRUCTIVE',
    ] as const;
    const saved: Record<string, string | undefined> = {};
    for (const key of testEnvironmentKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      expect(runReporter({ numPassedTests: 10, numFailedTests: 0, numPendingTests: 0, numFailedTestSuites: 0 })).not.toThrow();
    } finally {
      for (const key of testEnvironmentKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
