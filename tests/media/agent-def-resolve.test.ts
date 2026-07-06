import { expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import type { RunAgentInput } from '../../src/core/agent.ts';
import { type Agent, runDefinedAgent } from '../../src/core/agent-def.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';

function fakeAgent(): Agent {
  return {
    name: 'seer',
    description: 'looks at things',
    model: {} as LanguageModel,
    systemPrompt: 'You look at things.',
    tools: {},
  };
}

test('runDefinedAgent resolves media handles into attachments when a mediaStore is given', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'ad-')));
  await store.put(MediaKind.Image, new Uint8Array([1]), 'image/png');

  let captured: RunAgentInput | undefined;
  const runAgentImpl = mock(async (input: RunAgentInput) => {
    captured = input;
    return { text: 'done', steps: [] };
  });

  await runDefinedAgent(
    fakeAgent(),
    'see [img:img_1]',
    undefined,
    undefined,
    undefined,
    store,
    { runAgentImpl },
  );

  expect(runAgentImpl).toHaveBeenCalledTimes(1);
  expect(captured?.attachments?.length).toBe(1);
});

test('runDefinedAgent passes no attachments when no mediaStore is given', async () => {
  let captured: RunAgentInput | undefined;
  const runAgentImpl = mock(async (input: RunAgentInput) => {
    captured = input;
    return { text: 'done', steps: [] };
  });

  await runDefinedAgent(
    fakeAgent(),
    'see [img:img_1]',
    undefined,
    undefined,
    undefined,
    undefined,
    {
      runAgentImpl,
    },
  );

  expect(runAgentImpl).toHaveBeenCalledTimes(1);
  expect(captured?.attachments).toBeUndefined();
});
