import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type RunHandle = { id: string; dir: string };

/** Create (or reuse) the directory for a run and return its handle. */
export async function createRun(
  rootDir: string,
  id: string,
): Promise<RunHandle> {
  const dir = join(rootDir, id);
  await mkdir(dir, { recursive: true });
  return { id, dir };
}

/** Write a text artifact into the run directory; returns its full path. */
export async function writeArtifact(
  run: RunHandle,
  name: string,
  contents: string,
): Promise<string> {
  const path = join(run.dir, name);
  await writeFile(path, contents);
  return path;
}
