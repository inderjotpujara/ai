import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite } from '../agent-builder/write.ts';
import { cosine } from '../memory/embed-one.ts';
import { archiveIdleDays, reuseBands } from './config.ts';
import { removeEntry } from './manifest.ts';
import type { Manifest } from './types.ts';
import type { UsageStat } from './usage.ts';

export type ArchiveCandidate = { name: string; reason: string };

const DAY_MS = 86_400_000;

/** `cosine` throws on mismatched/empty vectors (e.g. entries embedded under
 *  different embed models, or `[]` from `rebuildFromArtifacts`); such pairs
 *  are "not comparable", never a garbage similarity score. */
function comparableVectors(a: number[], b: number[]): boolean {
  return a.length > 0 && a.length === b.length;
}

/** An entry is an archive candidate when it is idle (unused for longer than
 *  archiveIdleDays and zero uses in the observed window) AND a near-duplicate
 *  entry that IS in use exists. Idle-but-unique entries are preserved.
 *  `nowMs` is injected so decisions are deterministic and testable. */
export function archiveDecision(
  manifest: Manifest,
  usage: Record<string, UsageStat>,
  nowMs: number,
): ArchiveCandidate[] {
  const idleThresholdMs = archiveIdleDays() * DAY_MS;
  const reuseBand = reuseBands().reuse;
  const candidates: ArchiveCandidate[] = [];
  let incomparable = 0;
  for (const [name, entry] of Object.entries(manifest.entries)) {
    const lastUsedMs = usage[name]?.lastUsedMs ?? entry.createdAtMs;
    const idle =
      nowMs - lastUsedMs > idleThresholdMs &&
      (usage[name]?.useCount ?? 0) === 0;
    if (!idle) continue;
    const usedNearDuplicate = Object.entries(manifest.entries).find(
      ([otherName, other]) => {
        if (otherName === name) return false;
        if (!comparableVectors(entry.vector, other.vector)) {
          incomparable += 1;
          return false;
        }
        return (
          cosine(entry.vector, other.vector) >= reuseBand &&
          (usage[otherName]?.useCount ?? 0) > 0
        );
      },
    );
    if (usedNearDuplicate === undefined) continue;
    const idleDays = Math.floor((nowMs - lastUsedMs) / DAY_MS);
    candidates.push({
      name,
      reason: `idle ${idleDays} days, near-duplicate of ${usedNearDuplicate[0]} is in use`,
    });
  }
  if (incomparable > 0) {
    console.warn(
      `archiveDecision: skipped ${incomparable} vector pair(s) with mismatched/empty dimensions (not comparable)`,
    );
  }
  return candidates;
}

/** Thrown when an archive candidate is still referenced by another registered
 *  artifact (a crew member's `agentRef` or a workflow's agent step) — moving
 *  it aside would strand the referencing artifact at run time. */
export class LiveReferenceError extends Error {
  constructor(name: string, refs: string[]) {
    super(
      `archiveArtifact: "${name}" is still referenced by ${refs.join(', ')} — refusing to archive a live artifact`,
    );
    this.name = 'LiveReferenceError';
  }
}

/** Source patterns by which one registered artifact references another:
 *  a crew member's `agentRef: "<name>"` or a workflow step's
 *  `agent: "<name>"`. transpile.ts emits JSON.stringify'd double quotes;
 *  single quotes are covered for hand-edited files. */
function referenceNeedles(name: string): string[] {
  return [
    `agentRef: ${JSON.stringify(name)}`,
    `agent: ${JSON.stringify(name)}`,
    `agentRef: '${name}'`,
    `agent: '${name}'`,
  ];
}

/** Paths of artifact files in `refDirs` that still reference `name`. Scans
 *  top-level `*.ts` files only (`archive/` and `index.ts` excluded;
 *  `excludePath` skips the candidate's own file). Limitation: this is a
 *  textual scan of the generated-source reference patterns — a hand-edited
 *  file that references the artifact some other way is not detected. */
export function findLiveReferences(
  name: string,
  refDirs: string[],
  excludePath?: string,
): string[] {
  const needles = referenceNeedles(name);
  const hits: string[] = [];
  for (const refDir of refDirs) {
    if (!existsSync(refDir)) continue;
    for (const file of readdirSync(refDir)) {
      if (!file.endsWith('.ts') || file === 'index.ts') continue;
      const path = join(refDir, file);
      if (excludePath !== undefined && resolve(path) === excludePath) continue;
      const content = readFileSync(path, 'utf8');
      if (needles.some((needle) => content.includes(needle))) hits.push(path);
    }
  }
  return hits;
}

/** Move an artifact file into dir/archive/ (reversible-in-spirit: the file is
 *  preserved), drop its manifest entry, and drop any index.ts line that
 *  references it. Throws LiveReferenceError when another artifact in
 *  `refDirs` still references the candidate. Limitation: `refDirs` defaults
 *  to the candidate's own registry dir only — callers holding multiple
 *  registries (agents/crews/workflows) should pass all of them so a
 *  cross-registry reference (e.g. a crew using an agent) also blocks the
 *  archive. */
export function archiveArtifact(
  dir: string,
  name: string,
  refDirs: string[] = [dir],
): void {
  const refs = findLiveReferences(
    name,
    refDirs,
    resolve(join(dir, `${name}.ts`)),
  );
  if (refs.length > 0) {
    throw new LiveReferenceError(name, refs);
  }
  const archiveDir = join(dir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  renameSync(join(dir, `${name}.ts`), join(archiveDir, `${name}.ts`));
  removeEntry(dir, name);

  const indexPath = join(dir, 'index.ts');
  if (!existsSync(indexPath)) return;
  const lines = readFileSync(indexPath, 'utf8').split('\n');
  const kept = lines.filter((line) => !line.includes(`./${name}.ts`));
  if (kept.length === lines.length) return;
  atomicWrite(indexPath, kept.join('\n'));
}
