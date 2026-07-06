import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import { withGenerateSpan } from '../../telemetry/spans.ts';
import type { MediaStore } from '../store.ts';
import type {
  ExecMode,
  FileHandle,
  JobHandle,
  JobProgress,
  MediaKind,
} from '../types.ts';
import { JobStatus } from '../types.ts';

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
};

const defaultSpawn: SpawnFn = (cmd, args, opts) => {
  const proc = Bun.spawn([cmd, ...args], {
    env: { ...process.env, ...opts?.env },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return {
    pid: proc.pid,
    kill: (sig) => proc.kill(sig as never),
    onExit: (cb) => {
      proc.exited.then((code) => cb(code));
    },
  };
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

  child.onExit((code) => {
    if (currentStatus === JobStatus.Cancelled) {
      end();
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
        .finally(() => end());
      return;
    }
    currentStatus = JobStatus.Failed;
    settleReject(new Error(`generation failed (exit ${code})`));
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
