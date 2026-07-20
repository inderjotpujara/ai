import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import type { JobRecord } from '../../src/queue/types.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';
import {
  createTriggersEngine,
  type TriggerSecretStore,
} from '../../src/triggers/engine.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';
import type { TriggerDef } from '../../triggers/index.ts';

// ---- seams ----------------------------------------------------------------

const secretStore: TriggerSecretStore = { resolve: (): undefined => undefined };

/** A fake `setInterval`/`clearInterval` pair that records arming and clearing,
 *  so a test can assert stop() clears exactly the id start() armed — no real
 *  timer (no open handle). */
function fakeTimers() {
  let seq = 0;
  const armed: number[] = [];
  const cleared: number[] = [];
  const setInterval = ((): number => {
    const id = ++seq;
    armed.push(id);
    return id;
  }) as unknown as typeof globalThis.setInterval;
  const clearInterval = ((id: number): void => {
    cleared.push(id);
  }) as unknown as typeof globalThis.clearInterval;
  return { setInterval, clearInterval, armed, cleared };
}

/** A fake `chokidar.watch` that records watched paths and `.close()` calls, so
 *  a test can assert every watcher is released on stop() with no real fs
 *  handles. */
function fakeChokidar() {
  const watched: string[] = [];
  const closed: string[] = [];
  const watch = ((path: string) => {
    watched.push(path);
    const emitter = {
      on(): unknown {
        return emitter;
      },
      close: async (): Promise<void> => {
        closed.push(path);
      },
    };
    return emitter;
  }) as unknown as NonNullable<
    Parameters<typeof createTriggersEngine>[0]['watch']
  >;
  return { watch, watched, closed };
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

/** Build a fully-wired engine over throwaway temp dirs and fake seams.
 *  `makeRepoDefs` receives the freshly-created watch root so a file trigger's
 *  path can be confined under it. */
function harness(
  makeRepoDefs: (ctx: { watchRoot: string }) => Record<string, TriggerDef>,
) {
  const dbDir = mkdtempSync(join(tmpdir(), 'engine-db-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'engine-runs-'));
  const watchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'engine-watch-')));
  const jobStore = createJobStore({ path: dbDir }, {});
  stores.push(jobStore);
  const timers = fakeTimers();
  const chokidar = fakeChokidar();
  const engine = createTriggersEngine({
    jobStore,
    runsRoot,
    triggersDbPath: dbDir,
    secretStore,
    repoDefs: makeRepoDefs({ watchRoot }),
    config: { pollMs: 1000, watchRoot },
    now: () => Date.parse('2026-03-08T12:00:00Z'),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    watch: chokidar.watch,
  });
  stores.push(engine.store);
  return { engine, jobStore, watchRoot, timers, chokidar };
}

// ---- tests ----------------------------------------------------------------

test('engine start/stop lifecycle runs clean and syncs repo defs', async () => {
  const { engine } = harness(() => ({
    nightly: {
      name: 'nightly',
      type: TriggerType.Cron,
      target: { kind: JobKind.Chat, payload: {} },
      config: { schedule: '0 0 * * *' },
    },
  }));

  engine.start();

  // sync ran and placed the repo def in the store...
  const synced = engine.store.getByName('nightly', TriggerOrigin.Repo);
  expect(synced).toBeDefined();
  // ...and the scheduler's reconcile ran AFTER sync (order proof): a repo cron
  // that did not yet exist could never get its nextRunAt seeded.
  expect(synced?.nextRunAt).toBeGreaterThan(0);

  await engine.stop();
});

test('handleJobSettled forwards to the chain observer (fires the chained target)', async () => {
  const { engine } = harness(() => ({
    onDone: {
      name: 'onDone',
      type: TriggerType.JobChain,
      target: { kind: JobKind.Chat, payload: {} },
      config: { onStatus: JobStatus.Done },
    },
  }));
  engine.start();

  const trigger = engine.store.getByName('onDone', TriggerOrigin.Repo);
  if (!trigger) throw new Error('repo chain trigger was not synced');

  const finished: JobRecord = {
    id: 'job-src',
    kind: JobKind.Chat,
    payload: {},
    priority: JobPriority.Normal,
    status: JobStatus.Done,
    attempts: 1,
    maxAttempts: 3,
    createdAt: 1,
    updatedAt: 2,
    startedAt: 1,
    finishedAt: 2,
    availableAt: 0,
    runId: 'run-src',
    result: undefined,
    error: undefined,
    retriedFrom: null,
    origin: undefined,
    chainDepth: 0,
  };
  engine.handleJobSettled(finished, JobStatus.Done);
  await new Promise((r) => setTimeout(r, 25));

  // Forwarding proof: the chain observer fired through the SAME fire/store the
  // engine wired, recording a firing for the matched chain trigger.
  const firings = engine.store.listFirings(trigger.id, { limit: 10 });
  expect(firings.total).toBeGreaterThanOrEqual(1);

  await engine.stop();
});

test('stop() clears the scheduler interval, closes watchers, and closes the DB', async () => {
  const { engine, timers, chokidar } = harness(({ watchRoot }) => ({
    drop: {
      name: 'drop',
      type: TriggerType.File,
      target: { kind: JobKind.Chat, payload: {} },
      config: { path: join(watchRoot, 'in.csv') },
    },
  }));

  engine.start();
  expect(timers.armed.length).toBe(1);
  expect(chokidar.watched.length).toBe(1);

  await engine.stop();

  // scheduler interval cleared with exactly the id start() armed
  expect(timers.cleared).toEqual(timers.armed);
  // every watcher released
  expect(chokidar.closed.length).toBe(1);
  // DB closed — a post-stop read throws
  expect(() => engine.store.get('anything')).toThrow();
});
