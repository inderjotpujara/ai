import type { Agent } from '../core/agent-def.ts';
import {
  type OrchestratorResult,
  runOrchestrator,
} from '../core/orchestrator.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { appendJournal } from '../run/journal.ts';
import { createRun, writeArtifact } from '../run/run-store.ts';

export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
  routerNumCtx?: number;
  capture?: ResourceCapture;
};

/** Orchestrate one chat run: journal, run orchestrator, write artifact, journal. */
export async function runChat(deps: ChatDeps): Promise<OrchestratorResult> {
  const run = await createRun(deps.runsRoot, deps.runId);
  await appendJournal(run.dir, { step: 'start', data: { task: deps.task } });

  const result = await runOrchestrator(
    deps.orchestrator,
    deps.task,
    deps.routerNumCtx,
    deps.capture,
  );

  if (result.kind === 'answer') {
    await writeArtifact(run, 'answer.txt', result.text);
    await appendJournal(run.dir, {
      step: 'answer',
      data: { text: result.text },
    });
  } else if (result.kind === 'gap') {
    await writeArtifact(run, 'gap.txt', result.message);
    await appendJournal(run.dir, {
      step: 'gap',
      data: { missingCapability: result.missingCapability },
    });
  } else {
    await writeArtifact(run, 'resource.txt', result.message);
    await appendJournal(run.dir, {
      step: 'resource',
      data: { message: result.message },
    });
  }
  return result;
}
