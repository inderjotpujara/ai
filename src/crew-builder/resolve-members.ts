// src/crew-builder/resolve-members.ts
import type { CrewIR, WorkflowIR } from './ir.ts';
import type { CrewBuilderDeps, Shape } from './types.ts';

/** Collect referenced agent names — workflow: agent steps + map agent
 *  sub-steps (mirrors validate.ts's map sub-step handling); crew: members
 *  with an `agentRef`. */
function referencedAgents(ir: CrewIR | WorkflowIR, shape: Shape): string[] {
  const names = new Set<string>();
  if (shape === 'workflow') {
    for (const s of (ir as WorkflowIR).steps) {
      if (s.kind === 'agent') names.add(s.agent);
      if (s.kind === 'map' && s.step.kind === 'agent') names.add(s.step.agent);
    }
  } else {
    for (const m of (ir as CrewIR).members)
      if (m.agentRef) names.add(m.agentRef);
  }
  return [...names];
}

/** Auto-build every referenced agent that isn't already registered. Returns
 *  the names of agents built this run, or an `abandoned` reason if a
 *  required build is declined/fails. */
export async function resolveMissingAgents(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  deps: CrewBuilderDeps,
): Promise<{ builtAgents: string[]; abandoned?: string }> {
  const existing = new Set(deps.existingAgents());
  const builtAgents: string[] = [];
  for (const name of referencedAgents(ir, shape)) {
    if (existing.has(name)) continue;
    const built = await deps.buildMissingAgent(
      `an agent named "${name}" for use in "${ir.id}"`,
    );
    if (!built)
      return {
        builtAgents,
        abandoned: `required agent "${name}" was not built`,
      };
    builtAgents.push(built);
    existing.add(built);
  }
  return { builtAgents };
}
