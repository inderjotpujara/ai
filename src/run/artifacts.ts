import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactKind } from '../contracts/index.ts';

const FILE_KINDS: Record<string, ArtifactKind> = {
  'answer.txt': ArtifactKind.Answer,
  'gap.txt': ArtifactKind.Gap,
  'resource.txt': ArtifactKind.Resource,
  'result.txt': ArtifactKind.Result,
  'unverified.txt': ArtifactKind.Unverified,
  'failed.txt': ArtifactKind.Failed,
  'spans.jsonl': ArtifactKind.Spans,
  'degradation.jsonl': ArtifactKind.Degradation,
  'error.json': ArtifactKind.Error,
};

export type RunArtifact = { name: string; bytes: number; kind: ArtifactKind };

/** Sum of file sizes directly under `dir` (one level; media dirs are flat). */
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    total += (await stat(join(dir, entry.name))).size;
  }
  return total;
}

/**
 * Readdir + classify one run dir's artifacts into the extended `ArtifactKind`.
 * Missing dir → [] (the mapper tolerates a run with only spans.jsonl), same
 * fs-error tolerance as `readSpans` in `run-trace.ts`.
 */
export async function readRunArtifacts(runDir: string): Promise<RunArtifact[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(runDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: RunArtifact[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'media') {
        out.push({
          name: 'media',
          bytes: await dirBytes(join(runDir, 'media')),
          kind: ArtifactKind.Media,
        });
      }
      continue;
    }
    const kind = FILE_KINDS[entry.name] ?? ArtifactKind.Other;
    const bytes = (await stat(join(runDir, entry.name))).size;
    out.push({ name: entry.name, bytes, kind });
  }
  return out;
}
