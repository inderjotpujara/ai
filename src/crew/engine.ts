import type { ToolSet } from 'ai';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import { makeRecallTool } from '../memory/recall-tool.ts';
import type { MemoryStore } from '../memory/store.ts';
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
  /** Optional long-term memory store. When set: (1) each member gets a bound
   *  `recall` tool namespaced to the crew id, and (2) each sequential task's
   *  output is auto-persisted into that same namespace after it completes. */
  memory?: MemoryStore;
  /** Default memory auto-write policy when `memory` is set; a task's own
   *  `persistMemory` overrides it. Default true. */
  persistMemory?: boolean;
};

/** Build the crew's member agents keyed by name (for the sequential agent map).
 *  When `memory` is present, each member also gets a `recall` tool bound to
 *  the crew's namespace (namespace = crew id), merged alongside its own tools. */
export function crewAgentMap(
  crew: CrewDef,
  tools: ToolSet,
  memory?: MemoryStore,
): Record<string, Agent> {
  const map: Record<string, Agent> = {};
  const recallTools: ToolSet = memory
    ? { recall: makeRecallTool(memory, { namespace: crew.id }) }
    : {};
  for (const member of crew.members) {
    const memberTools = { ...(member.tools ?? tools), ...recallTools };
    map[member.name] = buildCrewAgent(member, memberTools);
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
          crewAgentMap(def, deps.tools, deps.memory),
          deps.onBeforeDelegate,
        );
      const outcome = await runWorkflow(wf, input, {
        runAgentStep,
        tools: deps.tools,
        maxParallel: deps.maxParallel,
        memory: deps.memory,
        persistMemory: deps.persistMemory ?? def.persistMemory,
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
