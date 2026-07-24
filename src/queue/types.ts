import type { RunOrigin } from '../contracts/enums.ts';

export enum JobStatus {
  Queued = 'queued',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Interrupted = 'interrupted',
  Canceled = 'canceled',
}

export enum JobPriority {
  High = 'high',
  Normal = 'normal',
}

// JobKind values are a SUBSET of RunKind's values (src/contracts/enums.ts:116)
// — the launchable run kinds — so a job's kind is always a valid RunKind for
// run creation + telemetry. This RESOLVES spec §5's "model-pull"/"builder"
// wording to RunKind.Pull / RunKind.Build (the real enum values) — the spike's
// prose names, mapped to the codebase's actual RunKind so no second, drifting
// kind vocabulary is introduced.
export enum JobKind {
  Chat = 'chat', // RunKind.Chat
  Crew = 'crew', // RunKind.Crew
  Workflow = 'workflow', // RunKind.Workflow
  Pull = 'pull', // RunKind.Pull  (spec "model-pull")
  Build = 'build', // RunKind.Build (spec "builder")
  Eval = 'eval', // RunKind.Eval (Slice 32: golden-set re-eval on a new model)
}

/** A queued task's durable record (camelCase TS side; columns are snake_case —
 *  mirrors `SessionRow`/`SessionRowRaw` in `src/session/store.ts:11`). */
export type JobRecord = {
  id: string;
  kind: JobKind;
  payload: unknown; // JSON blob — the run's launch input (validated per-kind at dispatch)
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  availableAt: number; // epoch-ms floor: not claimable until now >= availableAt (0 = immediately). Retry backoff sets this forward (Task 8) so claimNext (Task 7) actually spaces re-claims under concurrency.
  runId: string | undefined; // the runs/<id> this job's execution wrote to
  result: unknown; // terminal success payload (JSON), undefined until Done
  error: string | undefined; // terminal failure title, undefined unless Failed
  retriedFrom: string | null; // id of the job this one re-runs, null for an original (non-retry) job
  origin: RunOrigin | undefined; // Slice 25: how this job was triggered (schedule/webhook/api/…); undefined for pre-Slice-25 rows and directly-enqueued jobs
  chainDepth: number; // Slice 25 §7.3 A→B→A cycle guard: hop count incremented per chained fire, capped by fire.ts; 0 for a non-chained job
};

export type JobInput = {
  kind: JobKind;
  payload: unknown;
  priority?: JobPriority; // defaults to Normal
  maxAttempts?: number; // defaults to computed maxAttempts() (reliability/config.ts)
  availableAt?: number; // epoch-ms floor; defaults to 0 (immediately claimable). A caller may schedule a delayed job; retry backoff sets it forward internally.
  runId?: string; // caller may pre-mint (newRunId()); store mints if absent
  retriedFrom?: string; // set when this enqueue is a retry of an earlier job (lineage)
  origin?: RunOrigin; // Slice 25: how this job was triggered (schedule/webhook/api/…); omitted for directly-enqueued jobs
  chainDepth?: number; // Slice 25 §7.3 cycle-guard hop count; defaults to 0
};

/** Reserved second constructor arg — parity seam mirroring `SessionStoreDeps`
 *  (`src/session/store.ts:102`). Empty today. */
export type JobStoreDeps = Record<string, never>;
