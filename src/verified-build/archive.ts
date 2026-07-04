import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
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

/** Move an artifact file into dir/archive/ (reversible-in-spirit: the file is
 *  preserved), drop its manifest entry, and drop any index.ts line that
 *  references it. */
export function archiveArtifact(dir: string, name: string): void {
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
