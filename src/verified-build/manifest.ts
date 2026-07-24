import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../agent-builder/write.ts';
import { goldenPathFor, loadGolden } from './golden.ts';
import type { Manifest, ManifestEntry } from './types.ts';
import { VerifiedLevel } from './types.ts';

const MANIFEST_VERSION = 2;

function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, entries: {} };
}

/** Sidecar manifest path for a registry directory. */
export function manifestPath(dir: string): string {
  return join(dir, '.generated.json');
}

/** Read the manifest; absent or malformed yields an empty manifest (never throws). */
export function readManifest(dir: string): Manifest {
  const path = manifestPath(dir);
  if (!existsSync(path)) {
    return emptyManifest();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Manifest).entries !== 'object' ||
      (parsed as Manifest).entries === null
    ) {
      throw new Error('not a manifest object');
    }
    return parsed as Manifest;
  } catch (err) {
    console.warn(`readManifest: malformed ${path}, starting fresh (${err})`);
    return emptyManifest();
  }
}

function writeManifest(dir: string, manifest: Manifest): void {
  atomicWrite(manifestPath(dir), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Add or replace one entry (read-modify-write, atomic). */
export function upsertEntry(
  dir: string,
  name: string,
  entry: ManifestEntry,
): void {
  const manifest = readManifest(dir);
  manifest.entries[name] = entry;
  writeManifest(dir, manifest);
}

/** Drop one entry (read-modify-write, atomic). */
export function removeEntry(dir: string, name: string): void {
  const manifest = readManifest(dir);
  delete manifest.entries[name];
  writeManifest(dir, manifest);
}

const GOLDEN_SUFFIX = '.golden.json';

/** Rebuild manifest entries from the on-disk artifacts and their
 *  `<name>.golden.json` sidecars — offline recovery for a lost/corrupt
 *  `.generated.json` (the manifest is a rebuildable cache, the artifacts are
 *  the source of truth). Entries already present are preserved untouched;
 *  only names missing from the manifest are reconstructed: `need` (and
 *  `signature.purpose`) come from the golden file, `createdAtMs` from the
 *  artifact file's mtime. What cannot be recomputed offline gets safe
 *  defaults — vector `[]` (re-embedding needs a live model; reuse/archive
 *  treat `[]` as "not comparable") and `verifiedLevel: unverified`
 *  (re-verification needs a live run). `lastUsedMs`/`useCount` start at 0;
 *  live usage is span-derived via `aggregateUsage(runsRoot)`, not the
 *  manifest. Goldens without an artifact file (orphans) and malformed
 *  goldens are skipped. Persists the merged manifest when anything was
 *  recovered, and returns it. */
export function rebuildFromArtifacts(dir: string): Manifest {
  const manifest = readManifest(dir);
  if (!existsSync(dir)) return manifest;
  let recovered = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(GOLDEN_SUFFIX)) continue;
    const name = file.slice(0, -GOLDEN_SUFFIX.length);
    if (manifest.entries[name] !== undefined) continue;
    const artifactPath = join(dir, `${name}.ts`);
    if (!existsSync(artifactPath)) continue;
    const golden = loadGolden(join(dir, file));
    if (golden === null) continue;
    manifest.entries[name] = {
      need: golden.need,
      signature: {
        purpose: golden.need,
        tools: [],
        modelTier: '',
        io: '',
        roles: [],
      },
      vector: [],
      verifiedLevel: VerifiedLevel.Unverified,
      goldenPath: goldenPathFor(dir, name),
      createdAtMs: Math.floor(statSync(artifactPath).mtimeMs),
      lastUsedMs: 0,
      useCount: 0,
      lastEvalPass: false,
    };
    recovered += 1;
  }
  if (recovered > 0) writeManifest(dir, manifest);
  return manifest;
}
