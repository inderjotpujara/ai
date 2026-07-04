// src/crew-builder/write.ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewWritePaths, Shape } from './types.ts';

const IMPORTS_MARKER = '// CREW-BUILDER:IMPORTS';
const ENTRIES_MARKER = '// CREW-BUILDER:ENTRIES';

/** Snake_case names only — defense-in-depth mirror of agent-builder/write.ts:
 *  write.ts must not trust that every caller already ran validate.ts. */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

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

/** Write the generated crew/workflow def file and register it in the
 *  matching index (crews/index.ts or workflows/index.ts). Atomic per file;
 *  asserts the index markers exist BEFORE writing the def file so a bad
 *  index never leaves an orphan def file on disk. Returns files written. */
export function writeCrewOrWorkflow(
  name: string,
  source: string,
  shape: Shape,
  paths: CrewWritePaths,
): string[] {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `writeCrewOrWorkflow: invalid name ${JSON.stringify(name)} — must match ${NAME_PATTERN}`,
    );
  }
  const dir = shape === 'crew' ? paths.crewsDir : paths.workflowsDir;
  const indexPath =
    shape === 'crew' ? paths.crewsIndexPath : paths.workflowsIndexPath;
  // Check the index markers BEFORE writing the def file: if registration
  // would fail, we must not leave an orphan <dir>/<name>.ts on disk.
  const idx = assertIndexMarkers(indexPath);

  const written: string[] = [];
  const defPath = join(dir, `${name}.ts`);
  atomicWrite(defPath, source);
  written.push(defPath);

  const local = camelCase(name);
  registerInIndex(indexPath, idx, name, local);
  written.push(indexPath);
  return written;
}
