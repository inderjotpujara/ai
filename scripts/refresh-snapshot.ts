#!/usr/bin/env bun
/**
 * refresh-snapshot — regenerate `src/provisioning/catalog/snapshot.json`
 * (the committed catalog-fallback "robustness floor", see
 * `src/provisioning/catalog/snapshot-source.ts`) from LIVE catalog sources.
 *
 * Run manually (no cron — this is a deliberate, reviewed action):
 *
 *   bun run scripts/refresh-snapshot.ts
 *
 * When to run it: periodically (e.g. before a release) or whenever a curated
 * model's on-disk size has likely drifted (a runtime/quant bump upstream).
 * The diff shows up as a normal file change in `git status` — review it like
 * any other data change before committing.
 *
 * What it does / does NOT do:
 *   - The curated identity of each entry (provider/model/repo/quant/role/
 *     capabilities/downloads) is a human judgment call — this script does
 *     NOT invent or drop entries. It only re-derives `file_size_bytes` per
 *     entry from the authoritative live source for that entry's provider
 *     (Ollama registry manifest, or the HF repo tree for HF-backed entries),
 *     the same sources `enrichSize()` in `registry.ts` uses at runtime.
 *   - To add/remove a curated model, edit `snapshot.json` by hand (pick the
 *     role/capabilities), then run this script to fill in a live size.
 *
 * Safety: per-entry failures (network down, model renamed/removed upstream)
 * degrade to the entry's existing size — they never blank it out — so a
 * partial live outage can, at worst, leave some sizes unrefreshed. The file
 * is only written if the resulting snapshot is a structurally valid,
 * same-length replacement; if nothing changed, the file is left untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hfTreeSize } from '../src/provisioning/catalog/hf-catalog.ts';
import { ollamaManifestSize } from '../src/provisioning/catalog/ollama-catalog.ts';

const SNAPSHOT_PATH = fileURLToPath(
  new URL('../src/provisioning/catalog/snapshot.json', import.meta.url),
);

type SnapshotEntry = {
  provider: string;
  model: string;
  repo: string;
  quant?: string;
  params_billions: number;
  bytes_per_weight: number;
  file_size_bytes: number;
  downloads: number;
  role: string;
  capabilities?: string[];
};

/** Live, authoritative pre-pull size for one entry; throws on any failure
 *  (network, 404, unknown provider) so the caller can degrade per-entry. */
async function liveSizeFor(e: SnapshotEntry): Promise<number> {
  if (e.provider === 'Ollama') {
    const [model, tag = 'latest'] = e.model.split(':');
    return ollamaManifestSize(model ?? e.model, tag);
  }
  // HF-backed providers (HfGguf / HfSnapshot): sum the repo's file tree,
  // matching how `enrichSize()` sizes these at runtime.
  return hfTreeSize(e.repo, {});
}

/** Refresh one entry's size from its live source; degrade-never-crash: on
 *  any failure, return the entry unchanged (never zero it out). */
async function refreshEntry(e: SnapshotEntry): Promise<SnapshotEntry> {
  try {
    const fileSizeBytes = await liveSizeFor(e);
    if (!(fileSizeBytes > 0)) throw new Error('non-positive size');
    return { ...e, file_size_bytes: fileSizeBytes };
  } catch (err) {
    console.warn(
      `  ! ${e.model}: live size fetch failed (${(err as Error).message}); keeping existing ${e.file_size_bytes} bytes`,
    );
    return e;
  }
}

async function main(): Promise<void> {
  const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
  const original = JSON.parse(raw) as SnapshotEntry[];

  console.log(
    `Refreshing ${original.length} snapshot entries from live sources...`,
  );
  const refreshed = await Promise.all(original.map(refreshEntry));

  // Structural safety net: never write a shorter/malformed replacement, even
  // though refreshEntry() already degrades per-entry rather than dropping.
  if (refreshed.length !== original.length) {
    console.error(
      `Refusing to write: entry count changed (${original.length} -> ${refreshed.length}).`,
    );
    process.exitCode = 1;
    return;
  }

  const before = JSON.stringify(original);
  const after = JSON.stringify(refreshed);
  if (before === after) {
    console.log('No changes (all live sizes match the committed snapshot).');
    return;
  }

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(refreshed, null, 2)}\n`);
  console.log(`Wrote ${SNAPSHOT_PATH} with refreshed sizes.`);
}

main().catch((err) => {
  // Top-level failure (e.g. can't read/parse the existing file): abort
  // without writing anything, so the committed snapshot is never lost.
  console.error('refresh-snapshot failed:', err);
  process.exitCode = 1;
});
