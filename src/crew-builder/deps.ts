// src/crew-builder/deps.ts
import { agentNames } from '../../agents/index.ts';
import { CREWS } from '../../crews/index.ts';
import { WORKFLOWS } from '../../workflows/index.ts';
import { buildAgent } from '../agent-builder/builder.ts';
import { makeRealBuilderDeps } from '../agent-builder/deps.ts';
import type { BuilderDeps, BuildResult } from '../agent-builder/types.ts';
import { STARTER_PACK } from '../mcp/pack.ts';
import type { CrewBuilderDeps } from './types.ts';

/** Delegate to the agent-builder; return the built name or null on decline/invalid/abandon. */
export async function buildMissingAgentVia(
  need: string,
  build: (need: string, d: BuilderDeps) => Promise<BuildResult>,
  agentDeps: BuilderDeps,
): Promise<string | null> {
  const r = await build(need, agentDeps);
  return r.kind === 'written' ? r.proposal.name : null;
}

/** Assemble live crew/workflow-builder deps: reuses the agent-builder's live
 *  model + consent prompt, wires the current agent/pack/crew/workflow
 *  registries, and delegates missing-agent auto-build back to the
 *  agent-builder. Returns a cleanup that unloads the model. */
export async function makeRealCrewBuilderDeps(
  opts: { autoYes?: boolean } = {},
): Promise<{ deps: CrewBuilderDeps; cleanup: () => Promise<void> }> {
  const { deps: agentDeps, cleanup } = await makeRealBuilderDeps(opts);
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
  };
  return { deps, cleanup };
}
