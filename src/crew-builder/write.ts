// src/crew-builder/write.ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewWritePaths, Shape } from './types.ts';

const IMPORTS_MARKER = '// CREW-BUILDER:IMPORTS';
const ENTRIES_MARKER = '// CREW-BUILDER:ENTRIES';

/** Snake_case names only — defense-in-depth mirror of agent-builder/write.ts:
 *  write.ts must not trust that every caller already ran validate.ts.
 *  Single underscores only (no leading/trailing/repeated `_`): `camelCase`
 *  collapses runs of `_` together, so e.g. `my_flow` and `my__flow` would
 *  otherwise both produce the identifier `myFlow` — two distinct names
 *  colliding on one `import myFlow from ...` line in the shared index and
 *  corrupting it with a duplicate identifier. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function camelCase(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join('');
}

/** Read the target index and assert both registration markers are present.
 *  Called BEFORE any file is written, so a missing marker never leaves an
 *  orphan crew/workflow file that was written but couldn't be registered. */
function assertIndexMarkers(indexPath: string): string {
  const idx = readFileSync(indexPath, 'utf8');
  if (!idx.includes(IMPORTS_MARKER) || !idx.includes(ENTRIES_MARKER)) {
    throw new Error(`${indexPath} is missing the CREW-BUILDER markers`);
  }
  return idx;
}

function registerInIndex(
  indexPath: string,
  idx: string,
  name: string,
  local: string,
): void {
  const importLine = `import ${local} from './${name}.ts';\n`;
  const entryLine = `  [${local}.id]: ${local},\n`;
  if (!idx.includes(importLine))
    idx = idx.replace(IMPORTS_MARKER, importLine + IMPORTS_MARKER);
  if (!idx.includes(entryLine))
    idx = idx.replace(ENTRIES_MARKER, entryLine + ENTRIES_MARKER);
  atomicWrite(indexPath, idx);
}

function validateName(name: string, context: string): void {
  // Defense-in-depth mirror of agent-builder/write.ts's `validateName`:
  // write.ts must not assume validate.ts already ran on every call path.
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `${context}: invalid name ${JSON.stringify(name)} — must match ${NAME_PATTERN}`,
    );
  }
}

function indexPathFor(shape: Shape, paths: CrewWritePaths): string {
  return shape === 'crew' ? paths.crewsIndexPath : paths.workflowsIndexPath;
}

/** Write ONLY the generated def file (crews/<name>.ts or workflows/<name>.ts)
 *  via atomicWrite — no index splice. Split out (verified-build gate) so a
 *  candidate crew/workflow can be staged to disk and dry-run/eval'd BEFORE it
 *  is registered anywhere live — see `registerCrewOrWorkflow`. Returns the
 *  path written. */
export function writeCrewFile(
  name: string,
  source: string,
  shape: Shape,
  paths: CrewWritePaths,
): string {
  validateName(name, 'writeCrewFile');
  const dir = shape === 'crew' ? paths.crewsDir : paths.workflowsDir;
  const defPath = join(dir, `${name}.ts`);
  atomicWrite(defPath, source);
  return defPath;
}

/** Register an already-written def file in the matching index (crews/index.ts
 *  or workflows/index.ts) — the side effect that makes the crew/workflow
 *  live. Split out of `writeCrewOrWorkflow` so the verify-then-commit gate
 *  can call this ONLY after a staged file has earned it. Returns the index
 *  path written. */
export function registerCrewOrWorkflow(
  name: string,
  shape: Shape,
  paths: CrewWritePaths,
): string[] {
  validateName(name, 'registerCrewOrWorkflow');
  const indexPath = indexPathFor(shape, paths);
  const idx = assertIndexMarkers(indexPath);
  const local = camelCase(name);
  registerInIndex(indexPath, idx, name, local);
  return [indexPath];
}

/** Write the generated crew/workflow def file and register it in the
 *  matching index (crews/index.ts or workflows/index.ts). Atomic per file;
 *  asserts the index markers exist BEFORE writing the def file so a bad
 *  index never leaves an orphan def file on disk. Returns files written.
 *  Equivalent to `writeCrewFile` + `registerCrewOrWorkflow` — the one-shot
 *  entry point every non-gated caller (and these tests) still uses. */
export function writeCrewOrWorkflow(
  name: string,
  source: string,
  shape: Shape,
  paths: CrewWritePaths,
): string[] {
  validateName(name, 'writeCrewOrWorkflow');
  // Check the index markers BEFORE writing the def file: if registration
  // would fail, we must not leave an orphan <dir>/<name>.ts on disk.
  assertIndexMarkers(indexPathFor(shape, paths));
  const defPath = writeCrewFile(name, source, shape, paths);
  return [defPath, ...registerCrewOrWorkflow(name, shape, paths)];
}
