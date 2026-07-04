import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../agent-builder/write.ts';
import type { Manifest, ManifestEntry } from './types.ts';

const MANIFEST_VERSION = 1;

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
