import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal `.env.local` loader for the test runner. Vitest does not populate
 * `process.env` from dotenv files, and integration tests need the local Supabase
 * credentials. Existing environment variables always win.
 */
for (const file of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
