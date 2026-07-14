import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const CONTRACTS_DIR = join(import.meta.dir, '../../src/contracts');

/** Extract every module specifier from `import ... from '...'` / `export ... from '...'`. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

test('src/contracts imports only zod or sibling ./ files', () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(join(CONTRACTS_DIR, file), 'utf8');
    for (const spec of importSpecifiers(src)) {
      const ok = spec === 'zod' || spec.startsWith('./');
      expect(ok, `${file} has forbidden import "${spec}"`).toBe(true);
    }
  }
});
