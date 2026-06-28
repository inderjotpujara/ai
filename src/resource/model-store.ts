import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path to this project's local Ollama model store. */
export function projectStorePath(): string {
  return join(process.cwd(), 'model-images');
}

/**
 * Returns true if the Ollama server is serving from the project-local store.
 * Reliable signal: the store directory contains a `blobs` or `manifests` subdir,
 * which Ollama only creates when it has stored data there.
 */
export function isProjectStoreActive(
  storePath: string = projectStorePath(),
): boolean {
  if (existsSync(join(storePath, 'blobs'))) return true;
  if (existsSync(join(storePath, 'manifests'))) return true;
  return false;
}
