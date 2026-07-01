import type { ToolSet } from 'ai';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import { getWorkflow } from '../../workflows/index.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { WorkflowError } from '../core/errors.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { ATTR, annotateStep, withWorkflowSpan } from '../telemetry/spans.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { defineWorkflow } from '../workflow/define.ts';
import { defaultRunAgentStep, runWorkflow } from '../workflow/engine.ts';
import {
  StepKind,
  type WorkflowContext,
  type WorkflowDef,
  type WorkflowOutcome,
} from '../workflow/types.ts';
import { createSelectionRuntime } from './select-runtime.ts';
import { makeRealVerifyDeps } from './verify-runtime.ts';

export type FlowDeps = {
  def: WorkflowDef;
  input: unknown;
  runsRoot: string;
  runId: string;
  agents: Record<string, Agent>;
  tools: ToolSet;
  onBeforeDelegate?: BeforeDelegate; // live model selection
  /** Grounded-verification deps. Presence expands every agent step's
   *  verify → branch → corrective → abstain sub-graph, mirroring `--verify`
   *  at the CLI (src/crew/engine.ts's analogous crew-wide default). */
  verifyDeps?: VerifyDeps;
};

/** When verification is requested, mark every agent step `verify: true` (a
 *  workflow-wide default — there's no per-step opt-in surface at the CLI) so
 *  `defineWorkflow` splices the verify sub-graph in after each of them. */
function withVerifyFlags(def: WorkflowDef): WorkflowDef {
  return {
    ...def,
    steps: def.steps.map((step) =>
      step.kind === StepKind.Agent ? { ...step, verify: true } : step,
    ),
  };
}

/** The original (pre-verify-expansion) last step's validated output, rendered
 *  as text (as-is if string, else pretty JSON). Takes the *original* def even
 *  when verification expanded it: the answer step keeps its id unchanged (the
 *  verify sub-graph is spliced in after it, per src/verification/expand.ts),
 *  so this still points at the actual answer, not a `pass`/`abstain` step's
 *  `{accepted:true}`/marker output. */
function lastStepOutputText(
  originalDef: WorkflowDef,
  output: WorkflowContext,
): string {
  const last = originalDef.steps.at(-1);
  if (!last) throw new WorkflowError(`workflow ${originalDef.id} has no steps`);
  const value = output[last.id];
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Run a workflow with telemetry + artifact persistence (mirrors runChat). */
export async function runFlow(deps: FlowDeps): Promise<WorkflowOutcome> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    const def = deps.verifyDeps
      ? defineWorkflow(withVerifyFlags(deps.def), {
          verifyDeps: deps.verifyDeps,
        })
      : deps.def;
    return await withWorkflowSpan(def.id, async () => {
      const outcome = await runWorkflow(def, deps.input, {
        runAgentStep: defaultRunAgentStep(deps.agents, deps.onBeforeDelegate),
        tools: deps.tools,
      });
      annotateStep({ [ATTR.WORKFLOW_OUTCOME]: outcome.kind });
      if (outcome.kind === 'done') {
        await writeArtifact(
          run,
          'result.txt',
          lastStepOutputText(deps.def, outcome.output),
        );
      } else if (outcome.kind === 'unverified') {
        await writeArtifact(
          run,
          'unverified.txt',
          `step ${outcome.failedStepId ?? '?'} abstained (faithfulness ${outcome.faithfulness}); unsupported claims:\n${outcome.unsupportedClaims.join('\n')}\n\ndraft:\n${outcome.draft}`,
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

/** Split `--verify` out of the positional args (mirrors src/cli/crew.ts). */
function parseArgs(argv: string[]): { positional: string[]; verify: boolean } {
  const positional: string[] = [];
  let verify = false;
  for (const arg of argv) {
    if (arg === '--verify') verify = true;
    else positional.push(arg);
  }
  return { positional, verify };
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: bun run flow <name> [input...] [--verify]');
    process.exit(1);
  }
  const def = getWorkflow(name);
  if (!def) {
    console.error(`Unknown workflow: ${name}`);
    process.exit(1);
  }
  const { positional, verify } = parseArgs(rest);

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const selection = await createSelectionRuntime();
      try {
        const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };
        const agents: Record<string, Agent> = {};
        const fileQa = createFileQaAgent(fileServer.tools);
        const webFetch = createWebFetchAgent(fetchServer.tools);
        agents[fileQa.name] = fileQa;
        agents[webFetch.name] = webFetch;

        const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
        try {
          const outcome = await runFlow({
            def,
            input: positional.join(' ').trim(),
            runsRoot: 'runs',
            runId: `flow-${process.pid}`,
            agents,
            tools,
            onBeforeDelegate: selection.onBeforeDelegate,
            verifyDeps: verifyRuntime?.verifyDeps,
          });
          if (outcome.kind === 'done') {
            console.log(lastStepOutputText(def, outcome.output));
          } else if (outcome.kind === 'unverified') {
            console.error(
              `Workflow abstained at ${outcome.failedStepId ?? '?'} (unverified, faithfulness ${outcome.faithfulness}): ${outcome.unsupportedClaims.join('; ')}`,
            );
            process.exitCode = 1;
          } else {
            console.error(
              `Workflow failed at ${outcome.failedStep}: ${outcome.message}`,
            );
            process.exitCode = 1;
          }
        } finally {
          if (verifyRuntime) {
            verifyRuntime.store.close();
            await verifyRuntime.manager.unloadAll();
          }
        }
      } finally {
        await selection.close();
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
