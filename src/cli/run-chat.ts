import type { Agent } from '../core/agent-def.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { type RunHandle, writeArtifact } from '../run/run-store.ts';
import { setRunOutcome, withRunSpan } from '../telemetry/spans.ts';

export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  run: RunHandle;
  routerNumCtx?: number;
  capture?: ResourceCapture;
  signal?: AbortSignal;
};

export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const { run } = deps;
  return await withRunSpan(run.id, deps.task, async () => {
    const result = await runOrchestrator(
      deps.orchestrator,
      deps.task,
      deps.routerNumCtx,
      deps.capture,
      deps.signal,
    );
    setRunOutcome(result);
    if (result.kind === 'answer') {
      await writeArtifact(run, 'answer.txt', result.text);
    } else if (result.kind === 'gap') {
      await writeArtifact(run, 'gap.txt', result.message);
    } else {
      await writeArtifact(run, 'resource.txt', result.message);
    }
    return result;
  });
}
