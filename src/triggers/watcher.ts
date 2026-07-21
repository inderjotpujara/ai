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

import { mkdirSync, statSync } from 'node:fs';
import chokidar from 'chokidar';
import { createLogger, type Logger } from '../log/logger.ts';
import { confineWatchPath, expandHome } from './confine.ts';
import type { FireTrigger } from './fire.ts';
import type { TriggerStore } from './store.ts';
import {
  type FileConfig,
  FileEventKind,
  type Trigger,
  TriggerType,
} from './types.ts';

const defaultLog = createLogger('triggers.watcher');

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
  /**
   * Diff the store's currently-enabled file triggers against the set of
   * currently-attached watches (keyed by trigger id) and converge: ATTACH a
   * watch for any enabled file trigger not yet watched, DETACH (close + remove)
   * any attached watch whose trigger is no longer enabled or present. Idempotent
   * and synchronous per call; drives runtime pickup of console/CLI-created file
   * triggers the same way the scheduler polls the store for runtime crons. A
   * no-op until `start()` has created the watch root.
   */
  reconcile(): void;
  stop(): Promise<void>;
};

export function createFileWatcher(deps: {
  triggerStore: TriggerStore;
  fire: FireTrigger;
  watchRoot: string;
  watch?: typeof chokidar.watch;
  log?: Logger;
}): FileWatcher {
  const watchFn = deps.watch ?? chokidar.watch;
  const log = deps.log ?? defaultLog;
  // One watcher per trigger id (so reconcile/stop can close them all).
  const watchers = new Map<string, WatcherHandle>();
  // The expanded, confirmed-present watch root — set once `start()` succeeds.
  // `undefined` means "not started yet", so `reconcile()` is a safe no-op until
  // the root exists (confineWatchPath needs `realpathSync(root)` to succeed).
  let rootPath: string | undefined;

  function watchTrigger(t: Trigger, root: string): void {
    const cfg = t.config as FileConfig;
    let confined: string;
    try {
      // Re-confine at watch time even though create-time also confined
      // (defence in depth, §7.4). Runs at EVERY attach — boot and runtime.
      confined = confineWatchPath(cfg.path, root);
    } catch (err) {
      log.warn('skipping file trigger with an unconfinable path', {
        triggerId: t.id,
        path: cfg.path,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      const events = cfg.events ?? [FileEventKind.Add];
      const w = watchFn(confined, {
        awaitWriteFinish: AWAIT_WRITE_FINISH,
        ignoreInitial: true,
        depth: 0,
        // Belt-and-braces (§7.4): never follow an in-root symlink outward at
        // event time — a symlink can't extend the watch past the confinement
        // root, and it shrinks the create-vs-watch (TOCTOU) window.
        followSymlinks: false,
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
    } catch (err) {
      // A per-trigger attach failure logs-and-skips — it must never throw out
      // of reconcile (which runs on every poll tick) and wedge the loop.
      log.warn('failed to attach file watcher — skipping', {
        triggerId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function detach(id: string): void {
    const w = watchers.get(id);
    if (!w) return;
    watchers.delete(id);
    // Actually close the chokidar instance so the fs handle is released (no
    // leak). Fire-and-forget with a logging .catch — a rejected close must not
    // surface as an unhandledRejection nor throw out of reconcile.
    void w.close().catch((err: unknown) => {
      log.error('error closing detached file watcher', {
        triggerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  function reconcile(): void {
    // No-op until start() has created the watch root (confineWatchPath needs it).
    if (rootPath === undefined) return;
    const root = rootPath;
    // Snapshot the store's currently-enabled file triggers, keyed by id.
    let enabled: Map<string, Trigger>;
    try {
      enabled = new Map(
        deps.triggerStore
          .list()
          .filter((t) => t.enabled && t.type === TriggerType.File)
          .map((t) => [t.id, t]),
      );
    } catch (err) {
      // A wedged store must not throw out of reconcile (it runs on every tick).
      log.error('file watcher reconcile: store list failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    // DETACH watches whose trigger is no longer enabled/present (disabled /
    // deleted / repo-pruned).
    for (const id of [...watchers.keys()]) {
      if (!enabled.has(id)) detach(id);
    }
    // ATTACH any enabled file trigger not yet watched (no double-watch: an id
    // already in `watchers` is skipped).
    for (const [id, t] of enabled) {
      if (!watchers.has(id)) watchTrigger(t, root);
    }
  }

  return {
    start(): void {
      // Idempotency guard: a double-start must not re-run root setup + a second
      // attach pass (reconcile below is itself idempotent, but skip the mkdir).
      if (rootPath !== undefined) return;
      // I4: expand `~` FIRST, then ensure the confinement root exists private
      // (0700) BEFORE confining any trigger path under it — so the default
      // `~/.agent/inbox` exists and `realpathSync(root)` in confineWatchPath
      // succeeds on a fresh install.
      const root = expandHome(deps.watchRoot);
      try {
        mkdirSync(root, { recursive: true, mode: 0o700 });
      } catch (err) {
        // An unwritable/invalid parent must NOT crash start() (skip-with-warning
        // robustness posture). `rootPath` stays undefined so a later start()
        // retries (and reconcile stays a no-op until then).
        log.warn('watch root unavailable — file triggers disabled this start', {
          root,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // mkdir(mode) does NOT chmod an already-existing dir — a pre-existing
      // group/world-accessible inbox would stay loose silently. Warn (do NOT
      // auto-chmod a dir we didn't create); the watches still start.
      try {
        const st = statSync(root);
        if ((st.mode & 0o077) !== 0) {
          log.warn(
            'watch root has loose permissions (group/world-accessible)',
            {
              root,
              mode: (st.mode & 0o777).toString(8),
            },
          );
        }
      } catch {
        // A stat failure here is non-fatal; proceed to arm the watches.
      }
      rootPath = root;
      // Initial attach pass = a reconcile over an empty watcher set.
      reconcile();
    },
    reconcile,
    async stop(): Promise<void> {
      await Promise.all([...watchers.values()].map((w) => w.close()));
      watchers.clear();
      rootPath = undefined;
    },
  };
}
