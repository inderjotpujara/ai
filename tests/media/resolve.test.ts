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
