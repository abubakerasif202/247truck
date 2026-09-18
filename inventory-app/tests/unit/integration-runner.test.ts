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
  return () => execFileSync(process.execPath, ['runner.mjs'], { cwd: directory, stdio: 'pipe' });
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
  it('accepts a fresh passing report with zero skipped tests', () => {
    expect(runReporter({ numPassedTests: 10, numFailedTests: 0, numPendingTests: 0, numFailedTestSuites: 0 })).not.toThrow();
  });
});
