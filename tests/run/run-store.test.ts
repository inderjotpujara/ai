import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, writeArtifact } from '../../src/run/run-store.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('creates a run dir and writes an artifact into it', async () => {
  const run = await createRun(root, 'run-123');
  expect(run.id).toBe('run-123');
  expect(run.dir).toBe(join(root, 'run-123'));
  const path = await writeArtifact(run, 'answer.txt', 'the answer');
  expect(await readFile(path, 'utf8')).toBe('the answer');
});
