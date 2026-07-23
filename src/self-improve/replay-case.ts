import type { AgentFactory } from '../../agents/index.ts';
import type { Agent } from '../core/agent-def.ts';
import { runCrew } from '../crew/engine.ts';
import type { CrewDef } from '../crew/types.ts';
import { defaultRunAgentStep, runWorkflow } from '../workflow/engine.ts';
import type { WorkflowDef } from '../workflow/types.ts';

/** Seams `replayGoldenCase` binds over — all injected so the dispatch stays
 *  runtime-agnostic and unit-testable with no live model. `runCrew`/`runWorkflow`
 *  default to the real engines and are overridable in tests. */
export type ReplayCaseDeps = {
  /** The three artifact registries, resolved in this order (agent → crew →
   *  workflow), each keyed by artifact name. */
  agents: Record<string, AgentFactory>;
  crews: Record<string, CrewDef>;
  workflows: Record<string, WorkflowDef>;
  /** Run the resolved (MCP-free) agent against the task. Returns text OR the
   *  guarded-failure message (never throws) — the caller carries the live
   *  select-hook + abort signal this needs. */
  runAgent: (
    agent: Agent,
    input: string,
  ) => Promise<{ text: string } | { error: string }>;
  /** The agent map a workflow's agent steps resolve against — every registered
   *  agent built MCP-free (`factory({})`), mirroring crew-builder's
   *  `agentMapForWorkflowDryRun`. Built lazily so a non-workflow ref never pays. */
  workflowAgentMap: () => Record<string, Agent>;
  runCrew?: typeof runCrew;
  runWorkflow?: typeof runWorkflow;
};

/**
 * Replay ONE golden case against the CURRENT model for whichever artifact class
 * `ref` names — agent, crew, or workflow. This is the re-eval `runCase`: it
 * resolves `ref` across all three registries (never agents-only, the Task-16
 * defect that made a drifted crew/workflow throw `unknown ... for re-eval` →
 * terminal Failed) and dispatches on shape.
 *
 * The crew/workflow branches MIRROR `src/crew-builder/deps.ts`'s `runArtifact`
 * EXACTLY — the same `runCrew(def, task, { tools: {} })` /
 * `runWorkflow(def, task, { runAgentStep: defaultRunAgentStep(...), tools: {} })`
 * call shapes — so a re-eval replays each artifact class against the current
 * resolve the same way the build-time golden eval proved it (MCP-free, matching
 * the persisted baseline).
 *
 * Returns the artifact's text output for the judge; a run FAILURE returns its
 * message string (the judge then fails the case) rather than throwing — same
 * contract the agent branch always had. Throws ONLY when `ref` is in none of
 * the three registries — a genuine "unknown artifact for re-eval".
 */
export async function replayGoldenCase(
  ref: string,
  input: string,
  deps: ReplayCaseDeps,
): Promise<string> {
  const agentFactory = deps.agents[ref];
  if (agentFactory) {
    const outcome = await deps.runAgent(agentFactory({}), input);
    return 'error' in outcome ? outcome.error : outcome.text;
  }

  const crew = deps.crews[ref];
  if (crew) {
    const run = deps.runCrew ?? runCrew;
    const outcome = await run(crew, input, { tools: {} });
    if (outcome.kind === 'done') return String(outcome.output);
    if (outcome.kind === 'failed') return outcome.message ?? 'crew failed';
    return `unverified: unsupported claims (faithfulness ${outcome.faithfulness})`;
  }

  const workflow = deps.workflows[ref];
  if (workflow) {
    const run = deps.runWorkflow ?? runWorkflow;
    const outcome = await run(workflow, input, {
      runAgentStep: defaultRunAgentStep(deps.workflowAgentMap()),
      tools: {},
    });
    if (outcome.kind === 'done') return JSON.stringify(outcome.output);
    if (outcome.kind === 'failed') return outcome.message;
    return `unverified: unsupported claims (faithfulness ${outcome.faithfulness})`;
  }

  throw new Error(`unknown artifact for re-eval: ${ref}`);
}
