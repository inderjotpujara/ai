import type { ToolSet } from 'ai';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import { getWorkflow } from '../../workflows/index.ts';
import type { Agent } from '../core/agent-def.ts';
import { WorkflowError } from '../core/errors.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { ATTR, annotateStep, withWorkflowSpan } from '../telemetry/spans.ts';
import { defaultRunAgentStep, runWorkflow } from '../workflow/engine.ts';
import type {
  WorkflowContext,
  WorkflowDef,
  WorkflowOutcome,
} from '../workflow/types.ts';

export type FlowDeps = {
  def: WorkflowDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  agents: Record<string, Agent>;
  tools: ToolSet;
};

/** The last step's validated output, rendered as text (as-is if string, else pretty JSON). */
function lastStepOutputText(def: WorkflowDef, output: WorkflowContext): string {
  const last = def.steps.at(-1);
  if (!last) throw new WorkflowError(`workflow ${def.id} has no steps`);
  const value = output[last.id];
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Run a workflow with telemetry + artifact persistence (mirrors runChat). */
export async function runFlow(deps: FlowDeps): Promise<WorkflowOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    return await withWorkflowSpan(deps.def.id, async () => {
      const outcome = await runWorkflow(deps.def, deps.input, {
        runAgentStep: defaultRunAgentStep(deps.agents),
        tools: deps.tools,
      });
      annotateStep({ [ATTR.WORKFLOW_OUTCOME]: outcome.kind });
      if (outcome.kind === 'done') {
        await writeArtifact(
          run,
          'result.txt',
          lastStepOutputText(deps.def, outcome.output),
        );
      } else {
        await writeArtifact(
          run,
          'failed.txt',
          `step ${outcome.failedStep}: ${outcome.message}`,
        );
      }
      return outcome;
    });
  } finally {
    await tel.shutdown();
  }
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run flow <name> [input...]');
    process.exit(1);
  }
  const def = getWorkflow(name);
  if (!def) {
    console.error(`Unknown workflow: ${name}`);
    process.exit(1);
  }

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };
      const agents: Record<string, Agent> = {};
      const fileQa = createFileQaAgent(fileServer.tools);
      const webFetch = createWebFetchAgent(fetchServer.tools);
      agents[fileQa.name] = fileQa;
      agents[webFetch.name] = webFetch;

      const outcome = await runFlow({
        def,
        input: rest.join(' ').trim(),
        runsRoot: 'runs',
        runId: `flow-${process.pid}`,
        agents,
        tools,
      });
      if (outcome.kind === 'done') {
        console.log(lastStepOutputText(def, outcome.output));
      } else {
        console.error(
          `Workflow failed at ${outcome.failedStep}: ${outcome.message}`,
        );
        process.exitCode = 1;
      }
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
