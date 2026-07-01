import { tool } from 'ai';
import { z } from 'zod';
import { currentDelegationContext } from '../core/guardrails.ts';
import { retrievalBudgetChars } from './budget.ts';
import type { MemoryStore } from './store.ts';
import type { RetrievalResult } from './types.ts';

/** No relevant memory — an explicit abstention string, never a silent empty result. */
const NO_MEMORY_FOUND = 'No supporting memory found.';

/** Render retrieved chunks as citation-tagged text: `[mem:<id>] (<source>) <text>`. */
export function formatResults(results: RetrievalResult[]): string {
  if (results.length === 0) return NO_MEMORY_FOUND;
  return results
    .map((r) => `[mem:${r.id}] (${r.source}) ${r.text}`)
    .join('\n\n');
}

/** The `recall` tool: lets an agent pull relevant facts from long-term memory mid-run. */
export function makeRecallTool(
  store: MemoryStore,
  ctx: { space?: string; namespace?: string },
) {
  return tool({
    description:
      'Recall relevant facts from long-term memory. Cite results by their [mem:<id>] tag.',
    inputSchema: z.object({
      query: z.string().describe('What to search memory for'),
      topK: z.number().int().positive().optional(),
    }),
    execute: async ({ query, topK }) => {
      const results = await store.recall(query, {
        space: ctx.space,
        namespace: ctx.namespace,
        topK,
      });
      return formatResults(results);
    },
  });
}

/**
 * Opt-in auto-injection: prepend recalled context to a task prompt, fit to the
 * caller's live context budget. Returns `task` unchanged when nothing is found.
 */
export async function injectRecall(
  store: MemoryStore,
  ctx: { space?: string; namespace?: string },
  task: string,
): Promise<string> {
  const numCtx = currentDelegationContext().numCtx;
  const results = await store.recall(task, {
    space: ctx.space,
    namespace: ctx.namespace,
    numCtx,
  });
  if (results.length === 0) return task;
  const budget = retrievalBudgetChars(numCtx);
  let recalled = formatResults(results);
  if (recalled.length > budget) recalled = recalled.slice(0, budget);
  return `Relevant memory:\n${recalled}\n\n---\nTask:\n${task}`;
}
