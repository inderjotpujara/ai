#!/usr/bin/env bun
/**
 * docs-check — structural documentation guard (the hard line).
 *
 * Deterministic, no false positives. Run on every commit (pre-commit hook) and
 * in the pre-PR gate. Asserts:
 *   1. every living doc exists,
 *   2. the README links the documentation map and every living doc (no orphans),
 *   3. every src/<subsystem> is documented in docs/architecture.md
 *      (so a whole new subsystem can't land undocumented).
 *
 * It does NOT check semantic accuracy — that is the per-slice final-review
 * audit (see CLAUDE.md / docs/README.md). This only enforces presence + links.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Docs meant to be kept current. Per-slice specs/plans are immutable history, not listed. */
const LIVING_DOCS = [
  'README.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/ROADMAP.md',
  'agents/README.md',
  'model-images/README.md',
];

const failures: string[] = [];

// 1. Existence
for (const doc of LIVING_DOCS) {
  if (!existsSync(doc)) failures.push(`missing living doc: ${doc}`);
}

// 2. README links the doc map + every living doc (repo-root-relative paths)
const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : '';
/** Require an actual Markdown link `](path` — not an incidental substring. */
const linksTo = (md: string, path: string) => md.includes(`](${path}`);
if (!linksTo(readme, 'docs/README.md')) {
  failures.push('README.md must link the documentation map: docs/README.md');
}
for (const doc of LIVING_DOCS) {
  if (doc === 'README.md') continue;
  if (!linksTo(readme, doc)) {
    failures.push(`living doc not linked from README.md: ${doc}`);
  }
}

// 3. Every src/<subsystem> is named in docs/architecture.md
const arch = existsSync('docs/architecture.md')
  ? readFileSync('docs/architecture.md', 'utf8')
  : '';
if (existsSync('src')) {
  for (const entry of readdirSync('src')) {
    if (!statSync(join('src', entry)).isDirectory()) continue;
    if (!arch.includes(`src/${entry}`)) {
      failures.push(
        `subsystem src/${entry}/ is not documented in docs/architecture.md`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✖ docs-check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nThe hard line: docs stay current. Fix by linking the doc from README.md / the map,\n' +
      'or documenting the new subsystem in docs/architecture.md. See docs/README.md.\n',
  );
  process.exit(1);
}

console.log(
  '✔ docs-check: living docs present + linked; every src subsystem documented.',
);
