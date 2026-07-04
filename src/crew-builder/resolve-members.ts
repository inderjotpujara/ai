// src/crew-builder/resolve-members.ts
import type { CrewIR, WorkflowIR } from './ir.ts';
import type { CrewBuilderDeps, Shape } from './types.ts';

/** Collect referenced agent names — workflow: agent steps + map agent
 *  sub-steps (mirrors validate.ts's map sub-step handling); crew: members
 *  with an `agentRef`. */
export function referencedAgents(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
): string[] {
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

/** Rewrite every reference to `from` as `to` in a workflow's agent steps and
 *  map agent sub-steps. Returns a new WorkflowIR (input is not mutated). */
function renameWorkflowAgentRef(
  ir: WorkflowIR,
  from: string,
  to: string,
): WorkflowIR {
  return {
    ...ir,
    steps: ir.steps.map((s) => {
      if (s.kind === 'agent' && s.agent === from) return { ...s, agent: to };
      if (s.kind === 'map' && s.step.kind === 'agent' && s.step.agent === from)
        return { ...s, step: { ...s.step, agent: to } };
      return s;
    }),
  };
}

/** Rewrite every member's `agentRef === from` to `to` in a crew. Member
 *  `name` and task `member` links are untouched — tasks reference
 *  `member.name`, not `agentRef`. Returns a new CrewIR (input not mutated). */
function renameCrewAgentRef(ir: CrewIR, from: string, to: string): CrewIR {
  return {
    ...ir,
    members: ir.members.map((m) =>
      m.agentRef === from ? { ...m, agentRef: to } : m,
    ),
  };
}

/** Auto-build every referenced agent that isn't already registered. The
 *  agent-builder derives its own name from the need, which may differ from
 *  the referenced name — when it does, every reference to the requested
 *  name is rewritten to the actual built name in the returned IR. Returns
 *  the (possibly rewritten) IR, the names of agents built this run, or an
 *  `abandoned` reason if a required build is declined/fails. */
export async function resolveMissingAgents(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  deps: CrewBuilderDeps,
): Promise<{
  ir: CrewIR | WorkflowIR;
  builtAgents: string[];
  abandoned?: string;
}> {
  const existing = new Set(deps.existingAgents());
  const builtAgents: string[] = [];
  let current = ir;
  for (const name of referencedAgents(ir, shape)) {
    if (existing.has(name)) continue;
    const built = await deps.buildMissingAgent(
      `an agent named "${name}" for use in "${current.id}"`,
    );
    if (!built)
      return {
        ir: current,
        builtAgents,
        abandoned: `required agent "${name}" was not built`,
      };
    builtAgents.push(built);
    existing.add(built);
    if (built !== name)
      current =
        shape === 'workflow'
          ? renameWorkflowAgentRef(current as WorkflowIR, name, built)
          : renameCrewAgentRef(current as CrewIR, name, built);
  }
  return { ir: current, builtAgents };
}
