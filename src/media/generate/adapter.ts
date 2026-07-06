import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DegradationLedger,
  DegradeEvent,
} from '../../reliability/ledger.ts';
import { DegradeKind } from '../../reliability/ledger.ts';
import { withWallClock } from '../../reliability/timeout.ts';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import { recordDegrade, withGenerateSpan } from '../../telemetry/spans.ts';
import { defaultSpawn } from '../spawn.ts';
import type { MediaStore } from '../store.ts';
import type {
  FileHandle,
  JobHandle,
  JobProgress,
  MediaKind,
} from '../types.ts';
import { ExecMode, JobStatus } from '../types.ts';

/** Env fallback-only wall-clock default for media subprocess/poll waits — a
 *  hung engine fails the job instead of hanging the turn forever. Generous
 *  because video generation can legitimately take minutes. */
function defaultMediaTimeoutMs(): number {
  return Number(process.env.AGENT_MEDIA_TIMEOUT_MS) || 600_000;
}

export type GenOpts = {
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seconds?: number;
  image?: string;
  voice?: string;
  disableSafetyChecker?: boolean;
};

export type GenStrategy = {
  kind: MediaKind;
  execMode: ExecMode;
  buildOneShot?(
    prompt: string,
    outPath: string,
    opts: GenOpts,
  ): { cmd: string; args: string[]; env?: Record<string, string> };
  /** Maps the allocated `outPath` to the path the engine actually wrote,
   *  for engines that don't honor an exact output path (e.g. mlx-audio's
   *  Kokoro CLI writes `<file_prefix>_000.wav` instead of the given path).
   *  Omit when the strategy's CLI writes exactly `outPath`. */
  outputPathFor?(outPath: string): string;
  /** Parses a single stdout line into a progress event. Wiring stdout into
   *  the job's `progress` iterable is deferred to a later (video) task —
   *  `ChildHandle` currently exposes no stdout stream to read from. */
  parseProgress?(line: string): JobProgress | undefined;
  serverSubmit?(
    prompt: string,
    opts: GenOpts,
  ): Promise<{ poll(): Promise<JobProgress>; result(): Promise<string> }>;
};

type RunOneShotDeps = {
  spawn?: SpawnFn;
  /** Wall-clock cap on the spawned engine's exit wait. Env fallback-only
   *  (AGENT_MEDIA_TIMEOUT_MS); defaults to 10 minutes. */
  timeoutMs?: number;
};

/** Best-effort file extension for a scratch output path; the store re-derives
 *  its own extension from `mediaType` when the file is actually persisted, so
 *  this only needs to be a plausible name for the spawned CLI to write to. */
function extFor(mediaType: string): string {
  return mediaType.split('/')[1] ?? 'bin';
}

/** A single-consumer async queue of progress events that terminates once
 *  `end()` is called (i.e. when the job reaches a terminal status). */
function createProgressQueue(): {
  iterable: AsyncIterable<JobProgress>;
  push(item: JobProgress): void;
  end(): void;
} {
  const buffer: JobProgress[] = [];
  const waiting: Array<(res: IteratorResult<JobProgress>) => void> = [];
  let ended = false;

  function push(item: JobProgress): void {
    if (ended) return;
    const waiter = waiting.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    buffer.push(item);
  }

  function end(): void {
    if (ended) return;
    ended = true;
    for (const waiter of waiting.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  const iterable: AsyncIterable<JobProgress> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<JobProgress>> {
          const next = buffer.shift();
          if (next) return Promise.resolve({ value: next, done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiting.push(resolve));
        },
      };
    },
  };

  return { iterable, push, end };
}

/**
 * Runs a one-shot media generation job: spawns the strategy's CLI command,
 * waits for it to exit, and on success stores the produced file in
 * `MediaStore`. Returns a `JobHandle` whose `progress` iterable terminates as
 * soon as the job reaches a terminal status, and whose `result()`
 * resolves/rejects exactly once.
 */
export function runOneShotJob(
  strategy: GenStrategy,
  prompt: string,
  store: MediaStore,
  mediaType: string,
  opts: GenOpts,
  deps: RunOneShotDeps = {},
): JobHandle {
  const buildOneShot = strategy.buildOneShot;
  if (!buildOneShot) {
    throw new Error(`strategy for kind "${strategy.kind}" has no buildOneShot`);
  }
  const spawn = deps.spawn ?? defaultSpawn;
  const timeoutMs = deps.timeoutMs ?? defaultMediaTimeoutMs();

  const jobId = randomUUID();
  let currentStatus: JobStatus = JobStatus.Submitted;
  // `push` is unused for now — stdout-fed progress is wired in a later
  // (video) task once `ChildHandle` exposes a stdout stream to read.
  const { iterable, end } = createProgressQueue();

  let settled = false;
  let resolveResult!: (fh: FileHandle) => void;
  let rejectResult!: (err: Error) => void;
  const resultPromise = new Promise<FileHandle>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function settleResolve(fh: FileHandle): void {
    if (settled) return;
    settled = true;
    resolveResult(fh);
  }
  function settleReject(err: Error): void {
    if (settled) return;
    settled = true;
    rejectResult(err);
  }

  const outPath = join(
    tmpdir(),
    `media-gen-${randomUUID()}.${extFor(mediaType)}`,
  );
  const { cmd, args, env } = buildOneShot(prompt, outPath, opts);
  const startedAt = Date.now();
  const child = spawn(cmd, args, env ? { env } : undefined);
  currentStatus = JobStatus.Working;

  // Observability only: wraps `resultPromise` (the spawn→exit→store chain
  // that the callbacks below drive) so the completion is recorded as a
  // `media.generate` span. This must never change the settle logic that
  // `job.result()`/`job.status()`/`job.cancel()` depend on — `currentStatus`
  // is already updated to its terminal value by every path that settles
  // `resultPromise` (onExit success/failure, cancel), so it's safe to read
  // here to classify the outcome. The extra `.catch` below only prevents an
  // unhandled-rejection warning on this internal span promise; the original
  // rejection still propagates to whoever awaits `job.result()`.
  withGenerateSpan(
    {
      kind: strategy.kind,
      engine: cmd,
      model: opts.model,
      execMode: strategy.execMode,
    },
    async (rec) => {
      try {
        const fh = await resultPromise;
        rec.done('completed', Date.now() - startedAt, fh.sizeBytes);
        return fh;
      } catch (err) {
        const outcome =
          currentStatus === JobStatus.Cancelled ? 'cancelled' : 'failed';
        rec.done(outcome, Date.now() - startedAt);
        throw err;
      }
    },
  ).catch(() => {
    // already recorded on the span above; job.result() is the surface for
    // callers to observe success/failure.
  });

  // `exitPromise` resolves once the onExit callback chain below has fully
  // run its course (success store+settle, failure settle, or the cancel
  // early-return) — it never rejects. `withWallClock` races it against a
  // wall-clock timer so a hung engine (onExit never firing) is just another
  // terminal path, guarded by the same `settled` single-settle flag as
  // cancel/exit so it can never clobber an already-settled outcome.
  let markExitHandled!: () => void;
  const exitHandledPromise = new Promise<void>((resolve) => {
    markExitHandled = resolve;
  });

  child.onExit((code) => {
    if (currentStatus === JobStatus.Cancelled) {
      end();
      markExitHandled();
      return;
    }
    if (code === 0) {
      const actualOut = strategy.outputPathFor
        ? strategy.outputPathFor(outPath)
        : outPath;
      store
        .putFile(strategy.kind, actualOut, mediaType)
        .then((item) => {
          if (settled) return;
          currentStatus = JobStatus.Completed;
          settleResolve(store.toFileHandle(item));
        })
        .catch((err: unknown) => {
          if (settled) return;
          currentStatus = JobStatus.Failed;
          settleReject(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          end();
          markExitHandled();
        });
      return;
    }
    currentStatus = JobStatus.Failed;
    settleReject(new Error(`generation failed (exit ${code})`));
    end();
    markExitHandled();
  });

  withWallClock(timeoutMs, () => exitHandledPromise).catch(() => {
    if (settled) return;
    currentStatus = JobStatus.Failed;
    child.kill('SIGTERM');
    settleReject(new Error(`media job timed out after ${timeoutMs}ms`));
    end();
  });

  return {
    jobId,
    status: () => currentStatus,
    progress: iterable,
    result: () => resultPromise,
    async cancel(): Promise<void> {
      if (
        currentStatus === JobStatus.Completed ||
        currentStatus === JobStatus.Failed ||
        currentStatus === JobStatus.Cancelled
      ) {
        return;
      }
      currentStatus = JobStatus.Cancelled;
      child.kill('SIGTERM');
      settleReject(new Error('job cancelled'));
      end();
    },
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type RunServerDeps = {
  /** Delay between `poll()` calls. 0 in tests; a real server lane keeps a
   *  small default so it doesn't hammer the server every microtask. */
  pollIntervalMs?: number;
  /** Wall-clock cap on the whole submit→poll→result lifecycle (previously
   *  unbounded — the loop polled until `cancel()`). Env fallback-only
   *  (AGENT_MEDIA_TIMEOUT_MS); defaults to 10 minutes. */
  timeoutMs?: number;
};

/**
 * Runs a server-mode media generation job: calls the strategy's
 * `serverSubmit(prompt, opts)` to submit the job, then repeatedly `poll()`s
 * it — pushing each `JobProgress` onto the job's `progress` iterable — until
 * a poll reports completion (`fraction >= 1`), at which point it calls
 * `result()` to fetch the produced file's path and stores it in
 * `MediaStore`. Mirrors `runOneShotJob`'s single-settle + terminating-progress
 * + status discipline: `result()` resolves/rejects exactly once, and
 * `progress` terminates as soon as the job reaches a terminal status.
 */
export function runServerJob(
  strategy: GenStrategy,
  prompt: string,
  store: MediaStore,
  mediaType: string,
  opts: GenOpts,
  deps: RunServerDeps = {},
): JobHandle {
  const serverSubmit = strategy.serverSubmit;
  if (!serverSubmit) {
    throw new Error(`strategy for kind "${strategy.kind}" has no serverSubmit`);
  }
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const timeoutMs = deps.timeoutMs ?? defaultMediaTimeoutMs();

  const jobId = randomUUID();
  let currentStatus: JobStatus = JobStatus.Submitted;
  const { iterable, push, end } = createProgressQueue();

  let settled = false;
  let cancelled = false;
  let resolveResult!: (fh: FileHandle) => void;
  let rejectResult!: (err: Error) => void;
  const resultPromise = new Promise<FileHandle>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function settleResolve(fh: FileHandle): void {
    if (settled) return;
    settled = true;
    resolveResult(fh);
  }
  function settleReject(err: Error): void {
    if (settled) return;
    settled = true;
    rejectResult(err);
  }

  currentStatus = JobStatus.Working;
  const startedAt = Date.now();

  // Observability only — see the identical comment in `runOneShotJob` above;
  // this must never change the settle logic the callbacks below drive.
  withGenerateSpan(
    {
      kind: strategy.kind,
      engine: 'server',
      model: opts.model,
      execMode: strategy.execMode,
    },
    async (rec) => {
      try {
        const fh = await resultPromise;
        rec.done('completed', Date.now() - startedAt, fh.sizeBytes);
        return fh;
      } catch (err) {
        const outcome =
          currentStatus === JobStatus.Cancelled ? 'cancelled' : 'failed';
        rec.done(outcome, Date.now() - startedAt);
        throw err;
      }
    },
  ).catch(() => {
    // already recorded on the span above; job.result() is the surface for
    // callers to observe success/failure.
  });

  const runJob = async (): Promise<void> => {
    try {
      const submission = await serverSubmit(prompt, opts);
      while (!cancelled && !settled) {
        const progress = await submission.poll();
        if (cancelled || settled) return;
        push(progress);
        if (progress.fraction !== undefined && progress.fraction >= 1) {
          break;
        }
        await sleep(pollIntervalMs);
      }
      if (cancelled || settled) return;
      const path = await submission.result();
      if (cancelled || settled) return;
      const item = await store.putFile(strategy.kind, path, mediaType);
      if (settled) return;
      currentStatus = JobStatus.Completed;
      settleResolve(store.toFileHandle(item));
    } catch (err) {
      if (settled) return;
      currentStatus = JobStatus.Failed;
      settleReject(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // The poll loop was previously unbounded (ran until `cancel()`); a
  // wall-clock cap makes a hung/never-completing server job just another
  // terminal path, guarded by the same `settled` flag so it can never
  // clobber an already-settled outcome (`runJob` itself never rejects — all
  // its errors are caught and settled internally — so this `.catch` only
  // ever fires on timeout).
  withWallClock(timeoutMs, runJob)
    .catch(() => {
      if (settled) return;
      currentStatus = JobStatus.Failed;
      settleReject(new Error(`media job timed out after ${timeoutMs}ms`));
    })
    .finally(() => end());

  return {
    jobId,
    status: () => currentStatus,
    progress: iterable,
    result: () => resultPromise,
    async cancel(): Promise<void> {
      if (
        currentStatus === JobStatus.Completed ||
        currentStatus === JobStatus.Failed ||
        currentStatus === JobStatus.Cancelled
      ) {
        return;
      }
      cancelled = true;
      currentStatus = JobStatus.Cancelled;
      settleReject(new Error('job cancelled'));
      end();
    },
  };
}

export type RunGenDeps = RunOneShotDeps &
  RunServerDeps & {
    /** A same-`MediaKind` strategy in the other exec mode, tried when the
     *  primary's engine is unavailable. */
    fallback?: GenStrategy;
    /** Checks whether a one-shot engine binary is installed. Defaults to
     *  `Bun.which`; injectable so tests can force a "missing binary" degrade
     *  without touching the real PATH. */
    which?: (cmd: string) => string | null;
    /** Checks whether a server-mode engine is reachable. There is no default
     *  network probe here — ComfyUI isn't installed in this environment, so
     *  real reachability probing is deferred to the Slice 27 Phase C
     *  live-verify gate. Inject a probe to exercise the server→one-shot
     *  degrade path; without one, a server primary always runs as-is. */
    serverReachable?: (strategy: GenStrategy) => boolean;
    /** Optional in-run ledger; the degrade is always also recorded on the
     *  active telemetry span via `recordDegrade`. */
    ledger?: DegradationLedger;
  };

/** True when `candidate` is a usable fallback for `primary`: same
 *  `MediaKind`, the exec mode we're degrading to, and it actually carries
 *  the function that exec mode needs. */
function isUsableFallback(
  primary: GenStrategy,
  candidate: GenStrategy | undefined,
  wantExecMode: ExecMode,
): candidate is GenStrategy {
  if (!candidate) return false;
  if (candidate.kind !== primary.kind) return false;
  if (candidate.execMode !== wantExecMode) return false;
  if (wantExecMode === ExecMode.Server)
    return candidate.serverSubmit !== undefined;
  return candidate.buildOneShot !== undefined;
}

function recordExecModeDegrade(
  deps: { ledger?: DegradationLedger },
  from: ExecMode,
  to: ExecMode,
  subject: MediaKind,
  reason: string,
): void {
  const event: DegradeEvent = {
    kind: DegradeKind.ModelDegraded,
    subject,
    reason,
    detail: `${from}→${to}`,
    from,
    to,
    lane: 'media.generate',
  };
  deps.ledger?.record(event);
  recordDegrade(event);
}

/**
 * Picks the generation lane for `primary` by its `execMode` and runs the
 * job, degrading to `deps.fallback` (a same-`MediaKind` strategy in the
 * other exec mode) when the primary's engine is unavailable — never
 * crashing on a missing binary or unreachable server. If no usable fallback
 * is configured, `primary` runs as-is and any failure surfaces normally.
 */
export function runGenJob(
  primary: GenStrategy,
  prompt: string,
  store: MediaStore,
  mediaType: string,
  opts: GenOpts,
  deps: RunGenDeps = {},
): JobHandle {
  if (primary.execMode === ExecMode.OneShot) {
    const which = deps.which ?? ((cmd: string) => Bun.which(cmd));
    const probeOutPath = join(tmpdir(), `media-gen-probe-${randomUUID()}`);
    const cmd = primary.buildOneShot?.(prompt, probeOutPath, opts).cmd;
    const missing = cmd !== undefined && which(cmd) === null;
    const fallback =
      missing && isUsableFallback(primary, deps.fallback, ExecMode.Server)
        ? deps.fallback
        : undefined;
    if (fallback) {
      recordExecModeDegrade(
        deps,
        ExecMode.OneShot,
        ExecMode.Server,
        primary.kind,
        `engine binary "${cmd}" not found on PATH`,
      );
      return runServerJob(fallback, prompt, store, mediaType, opts, deps);
    }
    return runOneShotJob(primary, prompt, store, mediaType, opts, deps);
  }

  const serverReachable = deps.serverReachable ?? (() => true);
  const unreachable = !serverReachable(primary);
  const fallback =
    unreachable && isUsableFallback(primary, deps.fallback, ExecMode.OneShot)
      ? deps.fallback
      : undefined;
  if (fallback) {
    recordExecModeDegrade(
      deps,
      ExecMode.Server,
      ExecMode.OneShot,
      primary.kind,
      'server engine unreachable',
    );
    return runOneShotJob(fallback, prompt, store, mediaType, opts, deps);
  }
  return runServerJob(primary, prompt, store, mediaType, opts, deps);
}
