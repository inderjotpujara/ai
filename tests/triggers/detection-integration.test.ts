import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import type { JobRecord } from '../../src/queue/types.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';
import { EvalMode } from '../../src/server/jobs/dispatch.ts';
import {
  createTriggersEngine,
  type TriggerSecretStore,
} from '../../src/triggers/engine.ts';
import { TriggerOrigin } from '../../src/triggers/types.ts';
import type { TriggerDef } from '../../triggers/index.ts';
import { TRIGGERS } from '../../triggers/index.ts';

/**
 * Slice 32, Task 18 — DETECTION integration. Proves the two repo-defined
 * self-improvement triggers (`triggers/index.ts`) actually enqueue `Eval` jobs
 * end-to-end through the REAL trigger engine (sync → scheduler/chain → the
 * single `fire.ts` convergence → `jobStore.enqueue`). This is NOT a re-assert of
 * the static def shapes (Task 17 covered those) — it drives the live wiring:
 *   - Cron path:  a scheduler tick claims a due `reeval-sweep` cron → Eval(Sweep).
 *   - Chain path: a Pull job settling Done → `reeval-on-pull` → Eval(AffectedByPull).
 */

const NOW = Date.parse('2026-03-08T12:00:00Z');

const secretStore: TriggerSecretStore = {
  mint: () => ({ secretRef: 'ref', hmacSecret: 'secret' }),
  get: (): undefined => undefined,
  remove: (): void => {},
};

/** Fake `setInterval`/`clearInterval` pair with a synthetic tick — no real
 *  timer (no open handle), and `fireTick()` drives one scheduler poll pass. */
function fakeTimers() {
  let seq = 0;
  const callbacks: Array<() => void> = [];
  const setInterval = ((cb: () => void): number => {
    callbacks.push(cb);
    return ++seq;
  }) as unknown as typeof globalThis.setInterval;
  const clearInterval = ((
    _id: number,
  ): void => {}) as unknown as typeof globalThis.clearInterval;
  const fireTick = (): void => {
    for (const cb of callbacks) cb();
  };
  return { setInterval, clearInterval, fireTick };
}

const stores: Array<{ close(): void }> = [];
afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by a stop() under test */
    }
  }
});

/** Build a fully-wired engine over throwaway temp dirs and fake seams. Defaults
 *  the repo registry to the REAL `TRIGGERS` (so the actual `reeval-sweep` /
 *  `reeval-on-pull` defs are exercised); a test may inject `{}` to prove the
 *  wiring is what enqueues (the TDD control). */
function harness(repoDefs: Record<string, TriggerDef> = TRIGGERS) {
  const dbDir = mkdtempSync(join(tmpdir(), 'detect-db-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'detect-runs-'));
  const watchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'detect-watch-')));
  const jobStore = createJobStore({ path: dbDir }, {});
  stores.push(jobStore);
  const timers = fakeTimers();
  const engine = createTriggersEngine({
    jobStore,
    runsRoot,
    triggersDbPath: dbDir,
    secretStore,
    repoDefs,
    config: { pollMs: 1000, watchRoot },
    now: () => NOW,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    // No file triggers in these defs, so the real chokidar is never invoked;
    // a no-op watch keeps the watcher from touching the fs.
    watch: (() => ({
      on(): unknown {
        return this;
      },
      close: async (): Promise<void> => {},
    })) as unknown as Parameters<typeof createTriggersEngine>[0]['watch'],
  });
  stores.push(engine.store);
  return { engine, jobStore, timers };
}

/** All jobs currently enqueued, newest first. */
function enqueuedJobs(
  jobStore: ReturnType<typeof createJobStore>,
): JobRecord[] {
  return jobStore.listJobs({ limit: 100 }).items;
}

const pullJob = (): JobRecord => ({
  id: 'pull-src',
  kind: JobKind.Pull,
  payload: { model: 'llama3.2:3b' },
  priority: JobPriority.Normal,
  status: JobStatus.Done,
  attempts: 1,
  maxAttempts: 3,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 1,
  finishedAt: 2,
  availableAt: 0,
  runId: 'run-pull',
  result: undefined,
  error: undefined,
  retriedFrom: null,
  origin: undefined,
  chainDepth: 0,
});

// fire.ts is fire-and-forget with one trailing `await createRun`, so let the
// enqueue + audit settle before asserting.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

// ---- Cron sweep path ------------------------------------------------------

test('a scheduler tick on the due reeval-sweep cron enqueues an Eval(Sweep) job', async () => {
  const { engine, jobStore, timers } = harness();
  engine.start();

  // Sync placed the repo cron; reconcile seeded its nextRunAt to the next 4am
  // (future). Force it due, then drive a single synthetic poll tick — the
  // scheduler claims it and fires through the real fire.ts convergence.
  const sweep = engine.store.getByName('reeval-sweep', TriggerOrigin.Repo);
  if (!sweep) throw new Error('reeval-sweep was not synced into the engine');
  engine.store.update(sweep.id, { nextRunAt: NOW - 1000 });

  expect(enqueuedJobs(jobStore).length).toBe(0); // nothing before the tick
  timers.fireTick();
  await settle();

  const evals = enqueuedJobs(jobStore).filter((j) => j.kind === JobKind.Eval);
  expect(evals).toHaveLength(1);
  expect((evals[0]?.payload as { mode: EvalMode }).mode).toBe(EvalMode.Sweep);

  await engine.stop();
});

// ---- Pull JobChain path ---------------------------------------------------

test('a Pull job settling Done fires reeval-on-pull → Eval(AffectedByPull)', async () => {
  const { engine, jobStore } = harness();
  engine.start();

  // The chain observer path the worker pool invokes on a terminal settle.
  engine.handleJobSettled(pullJob(), JobStatus.Done);
  await settle();

  const evals = enqueuedJobs(jobStore).filter((j) => j.kind === JobKind.Eval);
  expect(evals).toHaveLength(1);
  expect((evals[0]?.payload as { mode: EvalMode }).mode).toBe(
    EvalMode.AffectedByPull,
  );

  await engine.stop();
});

// ---- TDD control: the wiring (not the harness) is what enqueues -----------

test('with an EMPTY repo registry neither path enqueues an Eval job (wiring proof)', async () => {
  const { engine, jobStore, timers } = harness({});
  engine.start();

  // No cron to become due; a Pull settle has no reeval-on-pull to match.
  timers.fireTick();
  engine.handleJobSettled(pullJob(), JobStatus.Done);
  await settle();

  expect(enqueuedJobs(jobStore).filter((j) => j.kind === JobKind.Eval)).toEqual(
    [],
  );

  await engine.stop();
});
