import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const outputDirectory = '.test-results';
const outputFile = `${outputDirectory}/integration.json`;
await mkdir(outputDirectory, { recursive: true });

const run = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration', '--reporter=json', `--outputFile=${outputFile}`],
  { stdio: 'inherit', env: process.env },
);
if (run.error) throw run.error;

let report;
try {
  report = JSON.parse(await readFile(outputFile, 'utf8'));
} catch {
  console.error('Integration results were not produced; treating the database gate as failed.');
  process.exit(run.status ?? 1);
}

const summary = {
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  skipped: report.numPendingTests ?? 0,
  suitesFailed: report.numFailedTestSuites ?? 0,
};
console.log(`Integration gate: ${JSON.stringify(summary)}`);
if ((run.status ?? 1) !== 0 || summary.failed > 0 || summary.suitesFailed > 0 || summary.skipped > 0) {
  if (summary.skipped > 0) console.error('Critical database tests were skipped; this is a hard CI failure.');
  process.exit(run.status && run.status !== 0 ? run.status : 1);
}
