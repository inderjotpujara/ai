import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactKind } from '../../src/contracts/enums.ts';
import { readRunArtifacts } from '../../src/run/artifacts.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'art-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('classifies known files and falls unknown files through to Other', async () => {
  await writeFile(join(dir, 'answer.txt'), 'hello');
  await writeFile(join(dir, 'result.txt'), 'r');
  await writeFile(join(dir, 'spans.jsonl'), '{}\n');
  await writeFile(join(dir, 'degradation.jsonl'), '{}\n');
  await writeFile(join(dir, 'error.json'), '{}');
  await writeFile(join(dir, 'random.log'), 'x');
  const arts = await readRunArtifacts(dir);
  const byName = new Map(arts.map((a) => [a.name, a]));
  expect(byName.get('answer.txt')?.kind).toBe(ArtifactKind.Answer);
  expect(byName.get('result.txt')?.kind).toBe(ArtifactKind.Result);
  expect(byName.get('spans.jsonl')?.kind).toBe(ArtifactKind.Spans);
  expect(byName.get('degradation.jsonl')?.kind).toBe(ArtifactKind.Degradation);
  expect(byName.get('error.json')?.kind).toBe(ArtifactKind.Error);
  expect(byName.get('random.log')?.kind).toBe(ArtifactKind.Other);
  expect(byName.get('answer.txt')?.bytes).toBe(5);
});

test('classifies gap/resource/unverified/failed text files', async () => {
  await writeFile(join(dir, 'gap.txt'), 'g');
  await writeFile(join(dir, 'resource.txt'), 're');
  await writeFile(join(dir, 'unverified.txt'), 'u');
  await writeFile(join(dir, 'failed.txt'), 'f');
  const arts = await readRunArtifacts(dir);
  const byName = new Map(arts.map((a) => [a.name, a]));
  expect(byName.get('gap.txt')?.kind).toBe(ArtifactKind.Gap);
  expect(byName.get('resource.txt')?.kind).toBe(ArtifactKind.Resource);
  expect(byName.get('unverified.txt')?.kind).toBe(ArtifactKind.Unverified);
  expect(byName.get('failed.txt')?.kind).toBe(ArtifactKind.Failed);
});

test('classifies the media/ directory as Media with a rolled-up byte size', async () => {
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeFile(join(dir, 'media', 'a.png'), '1234');
  await writeFile(join(dir, 'media', 'b.png'), '56');
  const arts = await readRunArtifacts(dir);
  const media = arts.find((a) => a.name === 'media');
  expect(media?.kind).toBe(ArtifactKind.Media);
  expect(media?.bytes).toBe(6);
});

test('returns [] for a missing run dir (never throws)', async () => {
  expect(await readRunArtifacts(join(dir, 'nope'))).toEqual([]);
});
