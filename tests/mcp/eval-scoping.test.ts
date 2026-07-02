import { describe, expect, it } from 'bun:test';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import qwenFast from '../../models/qwen-fast.ts';
import { createOllamaModel } from '../../src/providers/ollama.ts';

const ollamaUp = await fetch('http://localhost:11434/api/tags')
  .then(() => true)
  .catch(() => false);

const noop = (name: string, desc: string) =>
  tool({
    description: desc,
    inputSchema: z.object({ input: z.string() }),
    execute: async () => ({ ok: name }),
  });

// A merged-set stand-in shaped like the real pack: many plausible distractors.
const MERGED = {
  read_file: noop('read_file', 'Read a UTF-8 text file from disk.'),
  fetch: noop('fetch', 'Fetch a URL and return page content.'),
  query: noop('query', 'Run a read-only SQL SELECT.'),
  execute: noop('execute', 'Run a writing SQL statement.'),
  git_log: noop('git_log', 'Show git commit history.'),
  browser_navigate: noop('browser_navigate', 'Open a page in a browser.'),
  create_entities: noop(
    'create_entities',
    'Store entities in the knowledge graph.',
  ),
  get_time: noop('get_time', 'Get the current time in a timezone.'),
};
const SCOPED = { read_file: MERGED.read_file };

const CASES = [
  'Read the file ./README.md and tell me its first heading.',
  'What are the contents of package.json?',
  'Open ./docs/ROADMAP.md and summarize it.',
  'Show me what is inside src/mcp/pack.ts.',
];

async function firstToolPicked(
  tools: Record<string, unknown>,
  prompt: string,
): Promise<string | undefined> {
  const r = await generateText({
    model: createOllamaModel(qwenFast),
    tools: tools as Parameters<typeof generateText>[0]['tools'],
    prompt,
  });
  return r.toolCalls[0]?.toolName;
}

describe.skipIf(!ollamaUp)(
  'eval: agents-field scoping vs merged toolset',
  () => {
    it('scoped agent picks read_file ≥3/4; merged accuracy logged for comparison', async () => {
      let scopedHits = 0;
      let mergedHits = 0;
      for (const c of CASES) {
        if ((await firstToolPicked(SCOPED, c)) === 'read_file') scopedHits++;
        if ((await firstToolPicked(MERGED, c)) === 'read_file') mergedHits++;
      }
      console.error(
        `[eval] scoped ${scopedHits}/4 vs merged ${mergedHits}/4 (read_file tasks)`,
      );
      expect(scopedHits).toBeGreaterThanOrEqual(3);
    }, 120_000);
  },
);
