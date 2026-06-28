import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendJournal, readJournal } from '../../src/run/journal.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'journal-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('appends entries as ordered JSON lines and reads them back', async () => {
  await appendJournal(dir, { step: 'start' });
  await appendJournal(dir, { step: 'answer', data: { text: 'hi' } });
  const entries = await readJournal(dir);
  expect(entries).toEqual([
    { index: 0, step: 'start' },
    { index: 1, step: 'answer', data: { text: 'hi' } },
  ]);
});
