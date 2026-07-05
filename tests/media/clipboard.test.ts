import { expect, test } from 'bun:test';
import { captureClipboardImage } from '../../src/media/clipboard.ts';

test('returns undefined off darwin', async () => {
  expect(await captureClipboardImage({ platform: 'linux' })).toBeUndefined();
});

test('returns png bytes when clipboard holds an image', async () => {
  const run = async () => ({
    ok: true,
    bytes: new Uint8Array([137, 80, 78, 71]),
  });
  const got = await captureClipboardImage({ platform: 'darwin', run });
  expect(got?.mediaType).toBe('image/png');
  expect(Array.from(got?.bytes ?? [])).toEqual([137, 80, 78, 71]);
});

test('returns undefined when clipboard has no image', async () => {
  const run = async () => ({ ok: false });
  expect(
    await captureClipboardImage({ platform: 'darwin', run }),
  ).toBeUndefined();
});
