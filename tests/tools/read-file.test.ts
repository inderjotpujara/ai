import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileText, readFileTool } from '../../src/tools/read-file.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'readfile-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('readFileText returns file contents', async () => {
  const p = join(dir, 'note.txt');
  await writeFile(p, 'hello file');
  expect(await readFileText(p)).toBe('hello file');
});

test('tool execute returns text on success', async () => {
  const p = join(dir, 'note.txt');
  await writeFile(p, 'tool content');
  const result = await readFileTool.execute!({ path: p }, {} as never);
  expect(result).toEqual({ text: 'tool content' });
});

test('tool execute returns a structured error for a missing file', async () => {
  const result = await readFileTool.execute!(
    { path: join(dir, 'missing.txt') },
    {} as never,
  );
  expect(result).toHaveProperty('error');
});
