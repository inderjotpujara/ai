import type { Agent } from '../core/agent-def.ts';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import { runOrchestrator } from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';
import { initRunTelemetry } from '../telemetry/provider.ts';
import { setRunOutcome, withRunSpan } from '../telemetry/spans.ts';

export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
  routerNumCtx?: number;
  capture?: ResourceCapture;
};

export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const run = await createRun(deps.runsRoot, deps.runId);
  const tel = initRunTelemetry(run.dir);
  try {
    return await withRunSpan(deps.runId, deps.task, async () => {
      const result = await runOrchestrator(
        deps.orchestrator,
        deps.task,
        deps.routerNumCtx,
        deps.capture,
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
  } finally {
    await tel.shutdown();
  }
}
