import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTRACTS_DIR = join(import.meta.dir, '../../src/contracts');

/** Extract every module specifier from `import ... from '...'` / `export ... from '...'`. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    if (m[1] !== undefined) out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

/** Recursively collect every `.ts` file under `dir` (walks nested subdirs). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('src/contracts imports only zod or sibling ./ files (recursive, covers nested subdirs)', () => {
  const files = collectTsFiles(CONTRACTS_DIR);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const label = relative(CONTRACTS_DIR, file);
    for (const spec of importSpecifiers(src)) {
      const ok = spec === 'zod' || spec.startsWith('./');
      expect(ok, `${label} has forbidden import "${spec}"`).toBe(true);
    }
  }
});
