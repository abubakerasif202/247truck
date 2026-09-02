import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stock route contract', () => {
  it('ships the Stock Out page linked from the navigation', () => {
    const route = resolve(
      process.cwd(),
      'app',
      '(protected)',
      'stock',
      'out',
      'page.tsx',
    );

    expect(existsSync(route)).toBe(true);
  });
});
