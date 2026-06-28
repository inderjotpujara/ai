import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { answerFileQuestion } from '../../src/cli/answer-file-question.ts';
import { readJournal } from '../../src/run/journal.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cli-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('answers a question, writes the answer artifact, and journals the run', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'The file is a greeting.' }],
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
    }),
  });
  const tools = {
    read_file: tool({
      description: 'read a file',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ({ text: `contents of ${path}` }),
    }),
  };

  const answer = await answerFileQuestion({
    model,
    tools,
    question: 'Summarize notes.txt',
    runsRoot: root,
    runId: 'run-1',
  });

  expect(answer).toBe('The file is a greeting.');
  expect(await readFile(join(root, 'run-1', 'answer.txt'), 'utf8')).toBe(
    'The file is a greeting.',
  );
  const journal = await readJournal(join(root, 'run-1'));
  expect(journal.map((e) => e.step)).toEqual(['start', 'answer']);
});
