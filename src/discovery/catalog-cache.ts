import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candidate } from './catalog-source.ts';

/** Per-machine, git-ignored cache co-located with the model store. */
export function catalogPath(): string {
  return join(process.cwd(), 'model-images', 'catalog.json');
}

export function readCatalog(path: string = catalogPath()): Candidate[] | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf8')) as { candidates?: Candidate[] };
    return data.candidates;
  } catch {
    return undefined; // corrupt cache → treat as absent
  }
}

/** Atomic write (temp + rename) so a failure never corrupts an existing catalog. */
export function writeCatalog(candidates: Candidate[], path: string = catalogPath()): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ writtenAt: new Date().toISOString(), candidates }, null, 2));
  renameSync(tmp, path);
}

export function isStale(ttlMs: number, path: string = catalogPath()): boolean {
  try {
    if (!existsSync(path)) return true;
    return Date.now() - statSync(path).mtimeMs > ttlMs;
  } catch {
    return true;
  }
}
