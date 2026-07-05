import type { ToolSet } from 'ai';
import { AGENTS } from '../../agents/index.ts';
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import { makeRecallTool } from '../memory/recall-tool.ts';
import type { MemoryStore } from '../memory/store.ts';
import type { RetrievalResult } from '../memory/types.ts';
import type { DegradationLedger } from '../reliability/ledger.ts';
import { withCrewSpan } from '../telemetry/spans.ts';
import {
  isUnverifiedMarker,
  type UnverifiedMarker,
} from '../verification/expand.ts';
import type { VerifyDeps } from '../verification/types.ts';
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
  /** Injected grounded-verification deps. Required to activate any task's
   *  `verify` flag; absent = verify flags are inert and the crew compiles as
   *  today. The real Ollama-backed deps are wired by the CLI (Task 10); tests
   *  inject a fake with a controllable judge. */
  verifyDeps?: VerifyDeps;
  /** Re-recall used by the corrective (CRAG) path. Absent = corrective re-answers
   *  without fresh retrieval. Namespaced by the caller. */
  recall?: (query: string) => Promise<RetrievalResult[]>;
  /** Memory space verify fetches cited evidence + re-recalls from. Default 'default'. */
  verifySpace?: string;
  /** Bounded corrective attempts override; default `verifyMaxRetries()`. */
  verifyMaxRetries?: number;
  /** Faithfulness threshold override forwarded to verify. */
  verifyThreshold?: number;
  /** Optional degradation ledger; forwarded to the crew's delegation path
   *  (sequential agent steps and the hierarchical orchestrator's delegate
   *  tools) so a dropped member is recorded. */
  ledger?: DegradationLedger;
};

/** Scan a finished workflow context for an abstain marker (a verified task whose
 *  answer stayed unsupported after bounded correction). First marker wins. */
function findUnverified(
  output: Record<string, unknown>,
): UnverifiedMarker | undefined {
  for (const v of Object.values(output)) {
    if (isUnverifiedMarker(v)) return v;
  }
  return undefined;
}

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
    const factory = member.agentRef ? AGENTS[member.agentRef] : undefined;
    map[member.name] = factory
      ? factory(memberTools)
      : buildCrewAgent(member, memberTools);
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
      // Only build the verification sub-graph when deps are injected; without
      // them the compiler leaves verify flags inert (compiles as today).
      const verifyOpts = deps.verifyDeps
        ? {
            verifyDeps: deps.verifyDeps,
            space: deps.verifySpace,
            maxRetries: deps.verifyMaxRetries,
            threshold: deps.verifyThreshold,
          }
        : undefined;
      const wf = compileToWorkflow(def, verifyOpts);
      const runAgentStep =
        deps.runAgentStep ??
        defaultRunAgentStep(
          crewAgentMap(def, deps.tools, deps.memory),
          deps.onBeforeDelegate,
          deps.ledger,
        );
      const outcome = await runWorkflow(wf, input, {
        runAgentStep,
        tools: deps.tools,
        maxParallel: deps.maxParallel,
        memory: deps.memory,
        persistMemory: deps.persistMemory ?? def.persistMemory,
        recall: deps.recall,
        ledger: deps.ledger,
      });
      if (outcome.kind === 'done') {
        const unverified = findUnverified(
          outcome.output as Record<string, unknown>,
        );
        if (unverified) {
          return {
            kind: 'unverified',
            failedTaskId: unverified.answerStepId,
            unsupportedClaims: unverified.unsupportedClaims,
            faithfulness: unverified.faithfulness,
            draft: unverified.draft,
          };
        }
        return { kind: 'done', output: outcome.output };
      }
      if (outcome.kind === 'unverified') {
        // PRIMARY path for a crew verify-and-fail: the crew's compile-time splice
        // writes the abstain marker into ctx, and runWorkflow (Task 9) scans ctx
        // and returns {kind:'unverified'} directly — so this branch fires, not the
        // done+findUnverified branch above (which is now a defensive fallback).
        return {
          kind: 'unverified',
          failedTaskId: outcome.failedStepId,
          unsupportedClaims: outcome.unsupportedClaims,
          faithfulness: outcome.faithfulness,
          draft: outcome.draft,
        };
      }
      return {
        kind: 'failed',
        failedTask: outcome.failedStep,
        message: outcome.message,
      };
    }

    // Hierarchical: the orchestrator is the manager.
    const orch = buildHierarchicalOrchestrator(
      def,
      deps.onBeforeDelegate,
      deps.ledger,
    );
    const task = `${String(input)}\n\nComplete the crew's tasks by delegating to your members.`;
    const result = await runOrchestrator(orch, task);
    if (result.kind === 'answer') return { kind: 'done', output: result.text };
    return { kind: 'failed', message: result.message };
  });
}
