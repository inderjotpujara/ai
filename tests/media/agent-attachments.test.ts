import { expect, test } from 'bun:test';
import { buildCallInput } from '../../src/core/agent.ts';

test('no attachments -> prompt string', () => {
  expect(buildCallInput('hello', undefined)).toEqual({ prompt: 'hello' });
});

test('attachments -> messages with text + file parts', () => {
  const att = [
    {
      type: 'file' as const,
      mediaType: 'image/png',
      data: 'AQ==', // base64 (MediaFilePart.data is base64, not raw bytes)
    },
  ];
  expect(buildCallInput('describe', att)).toEqual({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'describe' }, ...att] },
    ],
  });
});
