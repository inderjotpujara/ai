/**
 * The triggers subsystem composition root (Slice 25, Task 15).
 *
 * Wires the whole subsystem — trigger store, the single `fire.ts` convergence
 * point, the poll-tick scheduler, the file watcher, the job-chain observer, and
 * the repo-registry sync — into ONE lifecycle-managed unit with `start()` /
 * `stop()`, so the daemon (Task 16) and a standalone server construct the
 * entire thing in a single call rather than hand-wiring six components.
 *
 * SHARED FIRE: exactly one `createFireTrigger` is built and injected into the
 * scheduler, the watcher, AND the chain observer, so every trigger source
 * (cron / file / chain — plus webhook/manual from the API surface) funnels
 * through the same convergence point (overlap/cap/provenance/audit live there).
 *
 * START ORDER (documented + enforced below):
 *   1. `syncRepoTriggers(store, repoDefs)` FIRST — the repo defs must be in the
 *      store before the scheduler reconciles/ticks, or a freshly-defined cron
 *      would not exist to be seeded/caught-up on the first tick.
 *   2. `scheduler.start()` — its own `reconcile()` runs before it arms the loop.
 *   3. `watcher.start()`.
 * STOP is the reverse teardown: `scheduler.stop()` → `await watcher.stop()` →
 * `store.close()` (each sub-stop is idempotent per its own guard). The chain
 * observer is NOT "started" — it is a callback the worker pool invokes on a
 * terminal settle; the engine EXPOSES `handleJobSettled` so Task 16 can pass it
 * to `createWorkerPool({ onSettled })`.
 *
 * CONFIG: `pollMs` / `watchRoot` / `maxChainDepth` resolve from `loadConfig()`
 * with an injected `config.*` override winning (never hardcode; env is the
 * fallback). `maxChainDepth` stays a getter (`() => number`) because that is the
 * seam `fire.ts` / the chain observer consume.
 *
 * SEAMS: `now` / `setInterval` / `clearInterval` thread into the scheduler and
 * `watch` into the file watcher, so tests drive fake time + synthetic fs events
 * with no real timers or open handles; the daemon passes none and gets the real
 * implementations.
 */

import type { TriggerDef } from '../../triggers/index.ts';
import { TRIGGERS } from '../../triggers/index.ts';
import { loadConfig } from '../config/schema.ts';
import type { JobStore } from '../queue/store.ts';
import type { JobRecord, JobStatus } from '../queue/types.ts';
import { createChainObserver } from './chain.ts';
import { createFireTrigger, type FireTrigger } from './fire.ts';
import { createScheduler } from './scheduler.ts';
import { createTriggerStore, type TriggerStore } from './store.ts';
import { syncRepoTriggers } from './sync.ts';
import { createFileWatcher } from './watcher.ts';

/**
 * Webhook secret-store seam (§7.1). The engine only HOLDS and EXPOSES the store
 * — webhook HMAC verification on the API surface (Task 19) consumes `get()`
 * downstream — so the engine depends on nothing from the store's internals.
 * The concrete `createTriggerSecretStore` (Task 18) persists these secrets to
 * `~/.agent/trigger-secrets.json` (0600). This declaration is the single source
 * of truth for the shape; the store imports it rather than forking it.
 */
export type TriggerSecretStore = {
  /** Mint a new HMAC secret, persist under a fresh secretRef, return both. */
  mint(): { secretRef: string; hmacSecret: string };
  /** Look up the HMAC secret for a secretRef (undefined if absent). */
  get(secretRef: string): string | undefined;
  /** Drop a secret (on trigger delete). */
  remove(secretRef: string): void;
};

export type TriggersEngine = {
  store: TriggerStore;
  secretStore: TriggerSecretStore;
  fire: FireTrigger;
  handleJobSettled: (
    job: JobRecord,
    status: JobStatus.Done | JobStatus.Failed,
  ) => void;
  start(): void;
  stop(): Promise<void>;
};

export function createTriggersEngine(deps: {
  jobStore: JobStore;
  runsRoot: string;
  triggersDbPath: string; // AGENT_QUEUE_PATH (same jobs.db dir the pool drains)
  secretStore: TriggerSecretStore;
  repoDefs?: Record<string, TriggerDef>; // defaults to the repo registry
  config?: { pollMs?: number; maxChainDepth?: number; watchRoot?: string };
  // Test seams (the daemon passes none → real implementations).
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  watch?: NonNullable<Parameters<typeof createFileWatcher>[0]['watch']>;
}): TriggersEngine {
  const loaded = loadConfig();
  const pollMs =
    deps.config?.pollMs ?? (loaded.values.AGENT_TRIGGERS_POLL_MS as number);
  const watchRoot =
    deps.config?.watchRoot ??
    (loaded.values.AGENT_TRIGGERS_WATCH_ROOT as string);
  // Kept a getter so the value stays live for fire.ts / the chain observer.
  const maxChainDepth = (): number =>
    deps.config?.maxChainDepth ??
    (loaded.values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH as number);

  const repoDefs = deps.repoDefs ?? TRIGGERS;

  // Construction (dependency order): store → fire → chain/scheduler/watcher.
  // The SINGLE fire is injected into all three consumers (shared convergence).
  const store = createTriggerStore({ path: deps.triggersDbPath });
  const fire = createFireTrigger({
    triggerStore: store,
    jobStore: deps.jobStore,
    runsRoot: deps.runsRoot,
    maxChainDepth,
  });
  const chain = createChainObserver({
    triggerStore: store,
    fire,
    maxChainDepth,
  });
  const scheduler = createScheduler({
    triggerStore: store,
    fire,
    pollMs,
    now: deps.now,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
  });
  const watcher = createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot,
    watch: deps.watch,
  });

  return {
    store,
    secretStore: deps.secretStore,
    fire,
    handleJobSettled: chain.handleJobSettled,
    start(): void {
      // Repo defs FIRST, so they are in the store before the scheduler's own
      // reconcile (inside scheduler.start) decides boot catch-up.
      syncRepoTriggers(store, repoDefs);
      scheduler.start();
      watcher.start();
    },
    async stop(): Promise<void> {
      // Reverse teardown; each sub-stop is idempotent per its own guard.
      scheduler.stop();
      await watcher.stop();
      store.close();
    },
  };
}
