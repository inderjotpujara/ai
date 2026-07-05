import { expect, test } from 'bun:test';
import {
  ATTR,
  withFrameSampleSpan,
  withTranscribeSpan,
} from '../../src/telemetry/spans.ts';

test('ATTR has media keys', () => {
  expect(ATTR.INPUT_MODALITY).toBe('gen_ai.input.modality');
  expect(ATTR.CONTENT_POLICY).toBe('content.policy');
});

test('span helpers run the body', async () => {
  expect(
    await withTranscribeSpan({ model: 'w', audioSeconds: 1 }, async () => 42),
  ).toBe(42);
  expect(
    await withFrameSampleSpan({ fps: 1, framesSampled: 3 }, async () => 'ok'),
  ).toBe('ok');
});

test('span helpers propagate errors thrown by the body', async () => {
  await expect(
    withTranscribeSpan({ model: 'w' }, async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  await expect(
    withFrameSampleSpan({ fps: 1 }, async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
});
