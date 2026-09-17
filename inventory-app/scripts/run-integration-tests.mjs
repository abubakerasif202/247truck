import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

const outputDirectory = '.test-results';
const outputFile = `${outputDirectory}/integration.json`;

const testEnvironmentKeys = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_ALLOW_DESTRUCTIVE',
];

const trimEnvironmentValue = (value) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const loadLocalTestEnvironment = async () => {
  let contents;
  try {
    contents = await readFile('.env.local', 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    if (!testEnvironmentKeys.includes(key) || process.env[key]) continue;
    process.env[key] = trimEnvironmentValue(line.slice(separator + 1));
  }
};

const requireDisposableLocalTestEnvironment = () => {
  const missing = testEnvironmentKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Integration tests require ${missing.join(', ')}.`);
  }

  const target = new URL(process.env.SUPABASE_TEST_URL);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname)
    || target.port !== '55331'
    || process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE !== 'true'
  ) {
    throw new Error('Integration tests require the disposable local Supabase stack at http://127.0.0.1:55331.');
  }
};

await loadLocalTestEnvironment();
requireDisposableLocalTestEnvironment();
await mkdir(outputDirectory, { recursive: true });
await rm(outputFile, { force: true });

const redactSensitive = (value) => String(value ?? '')
  .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  .replaceAll(/\b(?:postgres(?:ql)?):\/\/\S+/gi, '[REDACTED_DATABASE_URL]')
  .replaceAll(/\b(?:https?):\/\/\S+/gi, '[REDACTED_URL]')
  .replaceAll(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL)\s*[:=]\s*\S+/gi, '[REDACTED_CREDENTIAL]')
  .replaceAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
  .replaceAll(/\b(?:\+?61|0)4\d{8}\b/g, '[REDACTED_PHONE]')
  .replaceAll(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})?\b/g, '[REDACTED_TOKEN]');

const redact = (value) => redactSensitive(value).trim().slice(0, 500);

const firstFailureLine = (failureMessages) => {
  const lines = (Array.isArray(failureMessages) ? failureMessages : [])
    .flatMap(message => String(message).split(/\r?\n/))
    .map(line => redact(line))
    .filter(Boolean);
  return lines[0] ?? 'No concise failure message was reported.';
};

const sourceFile = (name) => {
  const path = relative(process.cwd(), String(name ?? '')).replaceAll('\\', '/');
  return path && !path.startsWith('../') ? path : 'Source file unavailable';
};

const run = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=.env.local',
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/integration',
    '--reporter=json',
    `--outputFile=${outputFile}`,
  ],
  { encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 },
);
if (run.stdout) process.stdout.write(redactSensitive(run.stdout));
if (run.stderr) process.stderr.write(redactSensitive(run.stderr));
let report;
try {
  report = JSON.parse(await readFile(outputFile, 'utf8'));
} catch {
  console.error('Integration results were not produced; treating the database gate as failed.');
  if (run.error) console.error(`Runner error: ${redact(run.error.name)}`);
  process.exit(run.status ?? 1);
}

const summary = {
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  skipped: report.numPendingTests ?? 0,
  suitesFailed: report.numFailedTestSuites ?? 0,
};
console.log(`Integration gate: ${JSON.stringify(summary)}`);

const failures = (Array.isArray(report.testResults) ? report.testResults : []).flatMap(suite =>
  (Array.isArray(suite.assertionResults) ? suite.assertionResults : [])
    .filter(test => test.status === 'failed')
    .map(test => ({
      suite: Array.isArray(test.ancestorTitles) && test.ancestorTitles.length > 0
        ? test.ancestorTitles.join(' > ')
        : sourceFile(suite.name),
      test: test.fullName ?? test.title ?? 'Unnamed test',
      message: firstFailureLine(test.failureMessages),
      file: sourceFile(suite.name),
    })),
);

for (const failure of failures) {
  console.error(`Failed suite: ${redact(failure.suite)}`);
  console.error(`Failed test: ${redact(failure.test)}`);
  console.error(`Failure: ${failure.message}`);
  console.error(`Source: ${failure.file}`);
}

if ((run.status ?? 1) !== 0 || summary.failed > 0 || summary.suitesFailed > 0 || summary.skipped > 0) {
  if (summary.skipped > 0) console.error('Critical database tests were skipped; this is a hard CI failure.');
  process.exit(run.status && run.status !== 0 ? run.status : 1);
}
