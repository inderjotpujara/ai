import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

for (const p of ['crews/index.ts', 'workflows/index.ts']) {
  test(`${p} has CREW-BUILDER markers`, () => {
    const src = readFileSync(p, 'utf8');
    expect(src).toContain('// CREW-BUILDER:IMPORTS');
    expect(src).toContain('// CREW-BUILDER:ENTRIES');
  });
}
