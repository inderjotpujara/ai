import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractHandles, resolveAttachments } from '../../src/media/resolve.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';

test('extractHandles finds image and video markers', () => {
  expect(extractHandles('what is in [img:img_1] and [video:vid_2]?')).toEqual([
    'img_1',
    'vid_2',
  ]);
});

test('resolveAttachments materializes image parts as v6 file parts', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'res-')));
  const item = await store.put(
    MediaKind.Image,
    new Uint8Array([9]),
    'image/png',
  );
  const parts = await resolveAttachments(
    `describe [${'img'}:${item.handle}]`,
    store,
  );
  expect(parts).toEqual([
    { type: 'file', mediaType: 'image/png', data: new Uint8Array([9]) },
  ]);
});

test('resolveAttachments expands a video frame-group into multiple parts', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'res-')));
  const frame1 = await store.put(
    MediaKind.Image,
    new Uint8Array([1]),
    'image/jpeg',
  );
  const frame2 = await store.put(
    MediaKind.Image,
    new Uint8Array([2]),
    'image/jpeg',
  );
  const frame3 = await store.put(
    MediaKind.Image,
    new Uint8Array([3]),
    'image/jpeg',
  );
  const group = store.registerGroup(
    [frame1.handle, frame2.handle, frame3.handle],
    '/tmp/frames',
  );

  const parts = await resolveAttachments(
    `describe [video:${group.handle}]`,
    store,
  );
  expect(parts.length).toBe(3);
  expect(parts.every((p) => p.mediaType === 'image/jpeg')).toBe(true);
});
