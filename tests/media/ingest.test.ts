import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestMedia } from '../../src/media/ingest.ts';
import { createMediaStore } from '../../src/media/store.ts';

function freshStore() {
  return createMediaStore(mkdtempSync(join(tmpdir(), 'ing-')));
}

test('--image flag stores the file and appends an img marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'a.png');
  writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(
    'what is this',
    { images: [p], audios: [], videos: [], paste: false },
    freshStore(),
  );
  expect(res.prompt).toBe('what is this [img:img_1]');
  expect(res.items.length).toBe(1);
});

test('a media-only prompt (no text) has no leading space before the marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'a.png');
  writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(
    '',
    { images: [p], audios: [], videos: [], paste: false },
    freshStore(),
  );
  expect(res.prompt).toBe('[img:img_1]');
});

test('--audio is transcribed to text and spliced into the prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'a.wav');
  writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(
    'summarize',
    { images: [], audios: [p], videos: [], paste: false },
    freshStore(),
    {
      transcribe: async () => 'hello world',
    },
  );
  expect(res.prompt).toContain('Transcript:');
  expect(res.prompt).toContain('hello world');
});

test('a dragged-in image path in the prompt is auto-detected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'b.jpg');
  writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(
    `describe ${p}`,
    { images: [], audios: [], videos: [], paste: false },
    freshStore(),
  );
  expect(res.prompt).toContain('[img:img_1]');
});

test('an auto-detected audio token blanked from the prompt leaves no double space', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const p = join(dir, 'd.wav');
  writeFileSync(p, new Uint8Array([1]));
  const res = await ingestMedia(
    `summarize ${p} please`,
    { images: [], audios: [], videos: [], paste: false },
    freshStore(),
    {
      transcribe: async () => 'hello world',
    },
  );
  expect(res.prompt).not.toContain('  ');
  expect(res.prompt.startsWith('summarize please')).toBe(true);
});

test('a failing audio transcription degrades per-item instead of aborting the turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-'));
  const imgPath = join(dir, 'c.png');
  const audioPath = join(dir, 'c.wav');
  writeFileSync(imgPath, new Uint8Array([1]));
  writeFileSync(audioPath, new Uint8Array([1]));
  const res = await ingestMedia(
    'what is this',
    { images: [imgPath], audios: [audioPath], videos: [], paste: false },
    freshStore(),
    {
      transcribe: async () => {
        throw new Error('mlx_whisper not found');
      },
    },
  );
  expect(res.items.length).toBe(1);
  expect(res.prompt).toContain('[img:img_1]');
  expect(res.prompt).not.toContain('Transcript:');
  expect(res.warnings.length).toBe(1);
  expect(res.warnings[0]).toContain(audioPath);
});
