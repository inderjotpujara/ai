import { z } from 'zod';
import {
  BuilderBuildRequestSchema,
  CrewRunRequestSchema,
  ModelPullRequestSchema,
  WorkflowRunRequestSchema,
} from '../../contracts/index.ts';
import { noopEventSink } from '../../core/events.ts';
import { ProviderKind } from '../../core/types.ts';
import type { CrewDef } from '../../crew/types.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import type { JobExecutor } from '../../queue/pool.ts';
import { JobKind, type JobKind as JobKindT } from '../../queue/types.ts';
import type { WorkflowDef } from '../../workflow/types.ts';
import type { RunBuilderTurn } from '../builders/build.ts';
import type { RunChatTurn } from '../chat/run-turn.ts';
import type { RunCrewTurn } from '../crews/run.ts';
import type { RunModelPullTurn } from '../models/pull.ts';
import type { RunWorkflowTurn } from '../workflows/run.ts';

/** What the dispatch registry needs to run each `JobKind` — the SAME turn
 *  functions the HTTP routes already build (`src/server/launch-turns.ts`) plus
 *  the crew/workflow registry lookups (`crews/index.ts`, `workflows/index.ts`).
 *  Injected so `dispatch.test.ts` exercises the payload→turn mapping with fakes,
 *  no real model. Slice 24 Incr 3. */
export type JobDispatchDeps = {
  runCrewTurn: RunCrewTurn;
  getCrew: (name: string) => CrewDef | undefined;
  runWorkflowTurn: RunWorkflowTurn;
  getWorkflow: (name: string) => WorkflowDef | undefined;
  runModelPull: RunModelPullTurn;
  runChatTurn: RunChatTurn;
  runBuilderTurn: RunBuilderTurn;
};

/** A crew/workflow job payload = the run's `{ input }` (validated by the same
 *  `*RunRequestSchema` the route uses) plus the `name` of the registered def. */
const CrewJobPayloadSchema = CrewRunRequestSchema.extend({
  name: z.string().min(1),
});
const WorkflowJobPayloadSchema = WorkflowRunRequestSchema.extend({
  name: z.string().min(1),
});

/** A pull job payload = the client-facing pull request (`runtime`+`modelRef`,
 *  validated by `ModelPullRequestSchema`) PLUS the `provider` the enqueue route
 *  resolved server-side (never client-trusted, D2) — dispatch does not re-resolve. */
const PullJobPayloadSchema = ModelPullRequestSchema.extend({
  provider: z.enum(ProviderKind),
});

/** A chat job payload = the task text + optional media-by-reference (already
 *  resolved to confined absolute paths by the enqueue route). A detached chat
 *  turn streams to its run journal, so events/stream are no-ops here. */
const ChatJobPayloadSchema = z.object({
  task: z.string(),
  media: z.custom<IngestFlags>().optional(),
});

/** A build job payload = the builder request (`kind`+`need`+flags) — the SAME
 *  `BuilderBuildRequestSchema` the route validates. A detached build has no
 *  live client to prompt, so confirm/confirmReuse fail-closed (decline — never
 *  auto-approve, mirroring `withConfirmTimeout`) and log is a no-op;
 *  `autoYes`/`force` in the payload still drive the builder's own deps. */
const BuildJobPayloadSchema = BuilderBuildRequestSchema;

/** A payload that fails its per-kind schema (or names a missing def) is a
 *  permanent, non-retryable defect — thrown here so the pool records a terminal
 *  `Failed`, never a retry loop. */
function requireRunId(job: { runId: string | undefined }): string {
  if (!job.runId) throw new Error('job has no runId (store must mint one)');
  return job.runId;
}

/**
 * Maps a `JobKind` to the `JobExecutor` the worker pool runs for it. Each
 * executor validates `job.payload` against that kind's schema, resolves the def
 * (crew/workflow) or args, then invokes the EXISTING run turn with the job's
 * pre-minted `runId` and the pool-provided `AbortSignal`, returning its result
 * (so the pool calls `markDone`) or throwing (so it calls `markFailed`). No
 * execution logic is duplicated — this is only the queue→turn seam.
 */
export function createJobDispatch(
  deps: JobDispatchDeps,
): (kind: JobKindT) => JobExecutor {
  return (kind) => {
    switch (kind) {
      case JobKind.Crew:
        return async (job) => {
          const { name, input } = CrewJobPayloadSchema.parse(job.payload);
          const def = deps.getCrew(name);
          if (!def) throw new Error(`unknown crew: ${name}`);
          return deps.runCrewTurn({ def, input, runId: requireRunId(job) });
        };
      case JobKind.Workflow:
        return async (job) => {
          const { name, input } = WorkflowJobPayloadSchema.parse(job.payload);
          const def = deps.getWorkflow(name);
          if (!def) throw new Error(`unknown workflow: ${name}`);
          return deps.runWorkflowTurn({ def, input, runId: requireRunId(job) });
        };
      case JobKind.Pull:
        return async (job) => {
          const { runtime, provider, modelRef } = PullJobPayloadSchema.parse(
            job.payload,
          );
          return deps.runModelPull({
            runtime,
            provider,
            modelRef,
            runId: requireRunId(job),
          });
        };
      case JobKind.Chat:
        return async (job, signal) => {
          const { task, media } = ChatJobPayloadSchema.parse(job.payload);
          // Execute under the job's pre-minted runId (T17 resolved the T16 seam
          // gap): RunChatTurn now accepts a runId and threads it into
          // `withMcpRun`, so the chat run dir === job.runId (the id returned as
          // `202 {runId}`) and `/api/runs/:runId/stream` polling resolves.
          return deps.runChatTurn({
            task,
            media,
            events: noopEventSink,
            stream: () => {},
            signal,
            runId: requireRunId(job),
          });
        };
      case JobKind.Build:
        return async (job) => {
          const {
            kind: builderKind,
            need,
            autoYes,
            force,
          } = BuildJobPayloadSchema.parse(job.payload);
          return deps.runBuilderTurn({
            kind: builderKind,
            need,
            autoYes,
            force,
            runId: requireRunId(job),
            confirm: async () => false,
            confirmReuse: async () => false,
            log: () => {},
          });
        };
      default: {
        const _exhaustive: never = kind;
        throw new Error(`unhandled job kind: ${String(_exhaustive)}`);
      }
    }
  };
}
