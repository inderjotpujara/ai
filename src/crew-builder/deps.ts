// src/crew-builder/deps.ts
import { AGENTS, agentNames } from '../../agents/index.ts';
import { CREWS } from '../../crews/index.ts';
import { WORKFLOWS } from '../../workflows/index.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import type { BuilderDeps, BuildResult } from '../agent-builder/types.ts';
import type { Agent } from '../core/agent-def.ts';
import { runCrew } from '../crew/engine.ts';
import type { CrewDef } from '../crew/types.ts';
import { STARTER_PACK } from '../mcp/pack.ts';
import { defaultRunAgentStep, runWorkflow } from '../workflow/engine.ts';
import type { WorkflowDef } from '../workflow/types.ts';
import type { CrewBuilderDeps, CrewBuilderVerifyDeps, Shape } from './types.ts';

/** Delegate to the agent-builder; return the built name or null on decline/invalid/abandon. */
export async function buildMissingAgentVia(
  need: string,
  build: (need: string, d: BuilderDeps) => Promise<BuildResult>,
  agentDeps: BuilderDeps,
): Promise<string | null> {
  const r = await build(need, agentDeps);
  return r.kind === 'written' ? r.proposal.name : null;
}

/** Every registered agent factory built with an empty tool set — the same
 *  "no real MCP tools yet" trade agent-builder's `agentFromProposal` makes
 *  for a staged agent (see its TODO). A staged WORKFLOW's agent steps can
 *  only resolve real agents by name (unlike a crew, whose `crewAgentMap`
 *  falls back to an inline member build), so `runArtifact` needs a concrete
 *  `runAgentStep` sourced from the live `AGENTS` registry.
 *  TODO(controller): mount real scoped MCP clients here once verification
 *  can spin them up for a not-yet-registered artifact. */
function agentMapForWorkflowDryRun(): Record<string, Agent> {
  const map: Record<string, Agent> = {};
  for (const [name, factory] of Object.entries(AGENTS)) {
    map[name] = factory({});
  }
  return map;
}

/** Run a staged (not-yet-registered) crew/workflow def against one task, for
 *  the verify-then-commit gate's dry-run/golden-eval calls. Mirrors
 *  agent-builder's `runAgent` wrapper of `runGuardedAgent`, dispatching on
 *  `shape` instead since crews and workflows have distinct engines/outcomes. */
async function runArtifact(
  def: unknown,
  shape: Shape,
  task: string,
): Promise<{ text: string } | { error: string }> {
  if (shape === 'crew') {
    const outcome = await runCrew(def as CrewDef, task, { tools: {} });
    if (outcome.kind === 'done') return { text: String(outcome.output) };
    if (outcome.kind === 'failed')
      return { error: outcome.message ?? 'crew failed' };
    return {
      error: `unverified: unsupported claims (faithfulness ${outcome.faithfulness})`,
    };
  }
  const outcome = await runWorkflow(def as WorkflowDef, task, {
    runAgentStep: defaultRunAgentStep(agentMapForWorkflowDryRun()),
    tools: {},
  });
  if (outcome.kind === 'done') return { text: JSON.stringify(outcome.output) };
  if (outcome.kind === 'failed') return { error: outcome.message };
  return {
    error: `unverified: unsupported claims (faithfulness ${outcome.faithfulness})`,
  };
}

/** Assemble live crew/workflow-builder deps: reuses the agent-builder's live
 *  model + consent prompt, wires the current agent/pack/crew/workflow
 *  registries, and delegates missing-agent auto-build back to the
 *  agent-builder. Returns a cleanup that unloads the model.
 *
 *  Also wires `deps.verify` (Slice 20 — the verify-then-commit gate), reusing
 *  the agent-builder's own `deps.verify` bundle (`makeRealBuilderDeps` always
 *  wires one, correctly, for its own member-agent auto-build path — see
 *  `agentDeps.verify` there) for the embedder/judge-candidates/judge/
 *  generator-family, and adding only `runArtifact` (crew/workflow-specific:
 *  wraps `runCrew`/`runWorkflow` instead of `runGuardedAgent`). */
export async function makeRealCrewBuilderDeps(
  opts: { autoYes?: boolean } = {},
): Promise<{ deps: CrewBuilderDeps; cleanup: () => Promise<void> }> {
  const { deps: agentDeps, cleanup } = await makeRealBuilderDeps(opts);
  const verify: CrewBuilderVerifyDeps | undefined = agentDeps.verify && {
    embed: agentDeps.verify.embed,
    judgeCandidates: agentDeps.verify.judgeCandidates,
    judge: agentDeps.verify.judge,
    generatorFamily: agentDeps.verify.generatorFamily,
    runArtifact,
  };
  const deps: CrewBuilderDeps = {
    model: agentDeps.model,
    existingAgents: () => agentNames(),
    packNames: () => STARTER_PACK.map((e) => e.name),
    existingCrews: () => Object.keys(CREWS),
    existingWorkflows: () => Object.keys(WORKFLOWS),
    confirm: agentDeps.confirm,
    buildMissingAgent: (need) =>
      buildMissingAgentVia(need, buildAgent, agentDeps),
    paths: {
      crewsDir: 'crews',
      crewsIndexPath: 'crews/index.ts',
      workflowsDir: 'workflows',
      workflowsIndexPath: 'workflows/index.ts',
    },
    agentPaths: agentDeps.paths,
    log: (m) => console.error(m),
    verify,
  };
  return { deps, cleanup };
}
