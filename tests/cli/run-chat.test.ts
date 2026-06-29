import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { runChat } from '../../src/cli/run-chat.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { readJournal } from '../../src/run/journal.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function gapOrchestrator(): Agent {
  // orchestrator model that calls report_capability_gap on turn 1
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'report_capability_gap',
              input: JSON.stringify({ missingCapability: 'send email' }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: {
              total: 1,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: undefined, reasoning: undefined },
          },
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: '' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: {
            total: 1,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return createOrchestrator({ model, systemPrompt: 'route', agents: [] });
}

test('runChat records a gap run and writes the gap artifact', async () => {
  const result = await runChat({
    orchestrator: gapOrchestrator(),
    task: 'email my boss',
    runsRoot: root,
    runId: 'run-1',
  });
  expect(result.kind).toBe('gap');
  expect(await readFile(join(root, 'run-1', 'gap.txt'), 'utf8')).toContain(
    'send email',
  );
  const journal = await readJournal(join(root, 'run-1'));
  expect(journal.map((e) => e.step)).toEqual(['start', 'gap']);
});
