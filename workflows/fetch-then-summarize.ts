import { z } from 'zod';
import { defineWorkflow } from '../src/workflow/define.ts';
import { StepKind } from '../src/workflow/types.ts';

/** tool(fetch) → agent(summarize): fetch a URL's content, then summarize it.
 *  The workflow input is the URL string. */
export default defineWorkflow({
  id: 'fetch-then-summarize',
  description: 'Fetch a URL with the fetch tool, then summarize via an agent.',
  steps: [
    {
      id: 'fetch',
      kind: StepKind.Tool,
      dependsOn: [],
      tool: 'fetch', // provided by mcp-server-fetch
      input: (ctx) => ({ url: String(ctx.input) }),
      output: z.unknown(),
    },
    {
      id: 'summarize',
      kind: StepKind.Agent,
      dependsOn: ['fetch'],
      agent: 'web_fetch',
      input: (ctx) =>
        `Summarize the following web page content in 3 concise bullet points:\n\n${JSON.stringify(ctx.fetch).slice(0, 8000)}`,
      output: z.string(),
    },
  ],
});
