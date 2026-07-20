/**
 * §7.4 — file triggers.
 *
 * Watches every enabled `TriggerType.File` trigger's path (confined under the
 * watch root) with chokidar v4. `awaitWriteFinish` holds an event until the
 * file size has been stable for `stabilityThreshold` ms, so a half-written drop
 * never fires. On a configured event (default `add`) the watcher calls
 * `fire.ts` with `reason: 'file'` and the matched path as `{{file.path}}`.
 *
 * chokidar sits behind an injectable `watch` seam so tests drive synthetic
 * events through a fake emitter (no real fs events / open handles); the daemon
 * uses the real `chokidar.watch`.
 *
 * Path confinement runs at watch-start time here (and again at trigger-creation
 * time in the API) — defence in depth (§7.4). A trigger whose path fails
 * confinement is skipped with a logged warning; it never crashes `start()`.
 */

import { mkdirSync } from 'node:fs';
import chokidar from 'chokidar';
import { createLogger } from '../log/logger.ts';
import { confineWatchPath, expandHome } from './confine.ts';
import type { FireTrigger } from './fire.ts';
import type { TriggerStore } from './store.ts';
import {
  type FileConfig,
  FileEventKind,
  type Trigger,
  TriggerType,
} from './types.ts';

const log = createLogger('triggers.watcher');

// Hold events until the file size is stable — a half-written drop never fires.
const AWAIT_WRITE_FINISH = {
  stabilityThreshold: 400,
  pollInterval: 100,
} as const;

/** The minimal slice of chokidar's `FSWatcher` this module uses. The injected
 *  `watch` seam returns the full `FSWatcher`; we narrow to this to avoid
 *  coupling to chokidar's generic `EventEmitter` typings. */
type WatcherHandle = {
  on(event: string, listener: (matchedPath: string) => void): unknown;
  close(): Promise<void>;
};

export type FileWatcher = {
  start(): void;
  stop(): Promise<void>;
};

export function createFileWatcher(deps: {
  triggerStore: TriggerStore;
  fire: FireTrigger;
  watchRoot: string;
  watch?: typeof chokidar.watch;
}): FileWatcher {
  const watchFn = deps.watch ?? chokidar.watch;
  // One watcher per trigger id (so stop() can close them all).
  const watchers = new Map<string, WatcherHandle>();
  let started = false;

  function watchTrigger(t: Trigger, root: string): void {
    const cfg = t.config as FileConfig;
    let confined: string;
    try {
      // Re-confine at watch time even though create-time also confined
      // (defence in depth, §7.4).
      confined = confineWatchPath(cfg.path, root);
    } catch (err) {
      log.warn('skipping file trigger with an unconfinable path', {
        triggerId: t.id,
        path: cfg.path,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const events = cfg.events ?? [FileEventKind.Add];
    const w = watchFn(confined, {
      awaitWriteFinish: AWAIT_WRITE_FINISH,
      ignoreInitial: true,
      depth: 0,
    }) as unknown as WatcherHandle;
    for (const ev of events) {
      w.on(ev, (matchedPath: string) => {
        // Fire-and-forget: fire.ts owns overlap/cap/provenance/audit and its
        // own errors, but a rejected promise here must never surface as an
        // unhandledRejection — attach a logging .catch.
        void deps
          .fire(t, { reason: 'file', vars: { 'file.path': matchedPath } })
          .catch((fireErr: unknown) => {
            log.error('file trigger fire rejected', {
              triggerId: t.id,
              error:
                fireErr instanceof Error ? fireErr.message : String(fireErr),
            });
          });
      });
    }
    w.on('error', (err: unknown) => {
      // A watcher-level error (e.g. EMFILE) must be logged, not thrown.
      log.error('file watcher error', {
        triggerId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    watchers.set(t.id, w);
  }

  return {
    start(): void {
      // Idempotency guard: a double-start must not arm a second set of
      // watchers (which would double-fire every trigger).
      if (started) return;
      started = true;
      // I4: expand `~` FIRST, then ensure the confinement root exists private
      // (0700) BEFORE confining any trigger path under it — so the default
      // `~/.agent/inbox` exists and `realpathSync(root)` in confineWatchPath
      // succeeds on a fresh install.
      const root = expandHome(deps.watchRoot);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      for (const t of deps.triggerStore.list()) {
        if (!t.enabled || t.type !== TriggerType.File) continue;
        watchTrigger(t, root);
      }
    },
    async stop(): Promise<void> {
      await Promise.all([...watchers.values()].map((w) => w.close()));
      watchers.clear();
      started = false;
    },
  };
}
