import type { ToolSet } from 'ai';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import { withCrewSpan } from '../telemetry/spans.ts';
import {
  defaultRunAgentStep,
  runWorkflow,
  type WorkflowDeps,
} from '../workflow/engine.ts';
import { buildHierarchicalOrchestrator, compileToWorkflow } from './compile.ts';
import { buildCrewAgent } from './member-agent.ts';
import { type CrewDef, type CrewOutcome, CrewProcess } from './types.ts';

export type CrewDeps = {
  runAgentStep?: WorkflowDeps['runAgentStep'];
  tools: ToolSet;
  maxParallel?: number;
  onBeforeDelegate?: BeforeDelegate;
};

/** Build the crew's member agents keyed by name (for the sequential agent map). */
export function crewAgentMap(
  crew: CrewDef,
  tools: ToolSet,
): Record<string, Agent> {
  const map: Record<string, Agent> = {};
  for (const member of crew.members) {
    map[member.name] = buildCrewAgent(member, member.tools ?? tools);
  }
  return map;
}

/** Run a crew: sequential -> the Slice-10 workflow engine; hierarchical -> the
 *  orchestrator. Wrapped in a crew.run span. The sequential path never throws
 *  (runWorkflow converts every step failure into a `failed` outcome); the
 *  hierarchical path inherits runOrchestrator's behavior, which rethrows on an
 *  unhandled (non-gap/non-resource) failure. */
export function runCrew(
  def: CrewDef,
  input: unknown,
  deps: CrewDeps,
): Promise<CrewOutcome> {
  return withCrewSpan(def.id, def.process, async () => {
    if (def.process === CrewProcess.Sequential) {
      const wf = compileToWorkflow(def);
      const runAgentStep =
        deps.runAgentStep ??
        defaultRunAgentStep(
          crewAgentMap(def, deps.tools),
          deps.onBeforeDelegate,
        );
      const outcome = await runWorkflow(wf, input, {
        runAgentStep,
        tools: deps.tools,
        maxParallel: deps.maxParallel,
      });
      if (outcome.kind === 'done')
        return { kind: 'done', output: outcome.output };
      return {
        kind: 'failed',
        failedTask: outcome.failedStep,
        message: outcome.message,
      };
    }

    // Hierarchical: the orchestrator is the manager.
    const orch = buildHierarchicalOrchestrator(def, deps.onBeforeDelegate);
    const task = `${String(input)}\n\nComplete the crew's tasks by delegating to your members.`;
    const result = await runOrchestrator(orch, task);
    if (result.kind === 'answer') return { kind: 'done', output: result.text };
    return { kind: 'failed', message: result.message };
  });
}
