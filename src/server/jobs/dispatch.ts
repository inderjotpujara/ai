import { z } from 'zod';
import {
  BuilderBuildRequestSchema,
  CrewRunRequestSchema,
  ModelPullRequestSchema,
  RunOrigin,
  WorkflowRunRequestSchema,
} from '../../contracts/index.ts';
import { noopEventSink } from '../../core/events.ts';
import type { OrchestratorResult } from '../../core/orchestrator.ts';
import { ProviderKind } from '../../core/types.ts';
import type { CrewDef } from '../../crew/types.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import type { JobExecutor } from '../../queue/pool.ts';
import { JobKind, type JobKind as JobKindT } from '../../queue/types.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import type { WorkflowDef } from '../../workflow/types.ts';
import type { RunBuilderTurn } from '../builders/build.ts';
import type { RunChatTurn } from '../chat/run-turn.ts';
import type { RunCrewTurn } from '../crews/run.ts';
import type { RunModelPullTurn } from '../models/pull.ts';
import type { RunWorkflowTurn } from '../workflows/run.ts';

/** Runs ONE registered specialist agent (by its `AGENTS` registry name) to
 *  completion under its own `withMcpRun` scope. Dispatch invokes it for a
 *  `JobKind.Chat` job that carries an `a2aRef` — an A2A Chat skill bound to a
 *  single agent (§7.4 / capstone B3) — so the job runs ONLY that agent, NOT the
 *  full super-agent orchestrator (which would expose every local specialist +
 *  MCP + remotes, the "run-anything" exposure D2 forbids). Implementations MUST
 *  be `async`. */
export type RunAgentTurn = (input: {
  ref: string;
  task: string;
  signal?: AbortSignal;
  runId: string;
}) => Promise<OrchestratorResult>;

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
  /** Runs a SINGLE registered agent for an A2A Chat skill bound to an agent ref
   *  (§7.4 / capstone B3). Optional so pre-B3 dispatch-unit fixtures that never
   *  enqueue an `a2aRef` chat job keep compiling; the real daemon/server wire it
   *  (`createRealRunAgentTurn`). A Chat job that DOES carry an `a2aRef` with this
   *  dep absent throws (a permanent, non-retryable defect — never a silent
   *  fall-through to the full orchestrator). */
  runAgentTurn?: RunAgentTurn;
  runBuilderTurn: RunBuilderTurn;
  /** Runs root the dispatched job's runId lives under (Task 24, item 17) —
   *  used ONLY to stamp the job's `origin` provenance marker `run-dto.ts`'s
   *  `readRunOrigin` later reads. Optional so existing dispatch-unit fixtures
   *  (which fake the turn functions and never touch disk) keep working
   *  unchanged; omitting it just skips the marker write. */
  runsRoot?: string;
};

/** A crew/workflow job payload = the run's `{ input }` (validated by the same
 *  `*RunRequestSchema` the route uses) plus the `name` of the registered def.
 *  An optional `resumeRunId` marks a re-enqueued run (Task 41): the executor
 *  runs the turn against the job's existing runId, whose per-node checkpoint
 *  (`runs/<runId>/checkpoint.json`, seeded in the engine loop) skips the
 *  already-completed DAG nodes — so resume is achieved by runId reuse, no
 *  separate hydration step. */
const CrewJobPayloadSchema = CrewRunRequestSchema.extend({
  name: z.string().min(1),
  resumeRunId: z.string().min(1).optional(),
});
const WorkflowJobPayloadSchema = WorkflowRunRequestSchema.extend({
  name: z.string().min(1),
  resumeRunId: z.string().min(1).optional(),
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
  /** Set ONLY by the A2A produce side (`a2a/server.ts`) for a Chat skill whose
   *  allowlisted ref is a single registered agent: the job must run ONLY that
   *  agent, never the full super-agent orchestrator (§7.4 / capstone B3). Absent
   *  for every non-A2A chat job (the synchronous `/api/chat` + normal enqueue),
   *  which keep the unchanged full-orchestrator behavior. */
  a2aRef: z.string().min(1).optional(),
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

/** Stamp `runs/<runId>/origin` = the job's provenance BEFORE the turn runs, so
 *  the marker exists by the time any span/artifact does — `run-dto.ts`'s
 *  `readRunOrigin` then projects `RunDTO.origin` (Schedule/Webhook/Api/Daemon)
 *  for this run instead of the manual-launch default, and the runs `?origin=`
 *  facet (Slice 25b) filters trigger-fired runs for free. `fire.ts` already sets
 *  `job.origin` per source (cron→Schedule, webhook→Webhook, file/chain→Api); a
 *  directly-enqueued job with no origin stamps `Daemon` (unchanged behavior).
 *  Every queue-dispatched job (chat/crew/workflow/pull/build) goes through this
 *  one seam, so no per-kind duplication. A missing `runsRoot` (dispatch-unit
 *  fixtures that never touch disk) just skips the write — the run then falls
 *  back to `Manual`, which is honest for a fixture that never dispatched through
 *  the real queue anyway.
 */
async function markJobOrigin(
  runsRoot: string | undefined,
  runId: string,
  origin: RunOrigin,
): Promise<void> {
  if (!runsRoot) return;
  const run = await createRun(runsRoot, runId);
  await writeArtifact(run, 'origin', origin);
}

/**
 * Maps a `JobKind` to the `JobExecutor` the worker pool runs for it. Each
 * executor validates `job.payload` against that kind's schema, resolves the def
 * (crew/workflow) or args, then invokes the EXISTING run turn with the job's
 * pre-minted `runId` and the pool-provided `AbortSignal`, returning its result
 * (so the pool calls `markDone`) or throwing (so it calls `markFailed`). No
 * execution logic is duplicated — this is only the queue→turn seam. Every
 * kind's executor is wrapped so `markJobOrigin` runs first (Task 24, item 17;
 * generalized in Slice 25 Task 20) — one seam covering all five kinds rather
 * than five call sites, stamping the JOB's own `origin` (falling back to
 * `Daemon` for a directly-enqueued job) so trigger-fired runs are attributed
 * to their source.
 */
export function createJobDispatch(
  deps: JobDispatchDeps,
): (kind: JobKindT) => JobExecutor {
  return (kind) => {
    const executor = buildExecutor(kind, deps);
    return async (job, signal) => {
      await markJobOrigin(
        deps.runsRoot,
        requireRunId(job),
        job.origin ?? RunOrigin.Daemon,
      );
      return executor(job, signal);
    };
  };
}

function buildExecutor(kind: JobKindT, deps: JobDispatchDeps): JobExecutor {
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
        const { task, media, a2aRef } = ChatJobPayloadSchema.parse(job.payload);
        // §7.4 / capstone B3: an A2A Chat skill bound to a single agent
        // (`a2aRef`) runs ONLY that registered agent — never the full
        // super-agent orchestrator (which would expose every local specialist +
        // MCP + remotes). No `a2aRef` ⇒ the unchanged full-orchestrator chat.
        if (a2aRef !== undefined) {
          if (!deps.runAgentTurn) {
            // Permanent defect (never a silent fall-through to the orchestrator):
            // an a2aRef job requires the single-agent runner to be wired.
            throw new Error(
              'chat job carries a2aRef but no runAgentTurn dep is wired',
            );
          }
          return deps.runAgentTurn({
            ref: a2aRef,
            task,
            signal,
            runId: requireRunId(job),
          });
        }
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
    case JobKind.Eval:
      // Slice 32 Task 5 registers JobKind.Eval across the enum spine only;
      // the real re-eval executor lands in Task 8. This stub exists solely
      // to keep the `_exhaustive: never` check below honest — no Eval job is
      // enqueued anywhere yet, so this branch is unreachable until Task 8
      // wires a real executor here (which must replace, not wrap, this stub).
      return async () => {
        throw new Error(
          'JobKind.Eval executor not yet implemented (Slice 32 Task 8)',
        );
      };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unhandled job kind: ${String(_exhaustive)}`);
    }
  }
}
