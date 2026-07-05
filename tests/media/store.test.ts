import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';

test('put mints a handle, writes bytes, and resolves them back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mediastore-'));
  const store = createMediaStore(dir);
  const item = await store.put(
    MediaKind.Image,
    new Uint8Array([1, 2, 3]),
    'image/png',
  );
  expect(item.handle).toBe('img_1');
  expect(item.path).toBe(join(dir, 'media', 'img_1.png'));
  expect(store.get('img_1')).toEqual(item);
  const bytes = await store.resolveBytes('img_1');
  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  const fh = store.toFileHandle(item);
  expect(fh.uri).toBe(`file://${item.path}`);
  expect(fh.sizeBytes).toBe(3);
});

test('resolveBytes throws a typed error for an unknown handle', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mediastore-')));
  await expect(store.resolveBytes('img_99')).rejects.toThrow(
    'unknown media handle',
  );
});
