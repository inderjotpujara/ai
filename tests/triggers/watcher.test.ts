import { afterEach, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '../../src/log/logger.ts';
import { JobKind } from '../../src/queue/types.ts';
import type {
  FireContext,
  FireResult,
  FireTrigger,
} from '../../src/triggers/fire.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import type { Trigger } from '../../src/triggers/types.ts';
import {
  FileEventKind,
  TriggerOrigin,
  TriggerType,
} from '../../src/triggers/types.ts';
import { createFileWatcher } from '../../src/triggers/watcher.ts';

// ---- test seams -----------------------------------------------------------

type Listener = (path: string) => void;
type WatchCall = { path: string; opts: Record<string, unknown> };

/** A fake `chokidar.watch` — records each watch() call and lets a test emit
 *  synthetic fs events, so no real fs events (or open handles) are involved. */
function fakeChokidar() {
  const calls: WatchCall[] = [];
  const closed: string[] = [];
  // event → listeners, keyed per watched path so multi-trigger tests are exact.
  const byPath = new Map<string, Map<string, Listener[]>>();
  const watch = ((path: string, opts: Record<string, unknown>) => {
    calls.push({ path, opts });
    const handlers = new Map<string, Listener[]>();
    byPath.set(path, handlers);
    const emitter = {
      on(event: string, cb: Listener) {
        const arr = handlers.get(event) ?? [];
        arr.push(cb);
        handlers.set(event, arr);
        return emitter;
      },
      close: async (): Promise<void> => {
        closed.push(path);
      },
    };
    return emitter;
  }) as unknown as typeof import('chokidar').watch;
  const emit = (path: string, event: string, filePath: string): void => {
    for (const cb of byPath.get(path)?.get(event) ?? []) cb(filePath);
  };
  return { watch, emit, calls, closed };
}

const stores: ReturnType<typeof createTriggerStore>[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function newStore(): ReturnType<typeof createTriggerStore> {
  const s = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'wtc-')) });
  stores.push(s);
  return s;
}

const realRoot = (): string =>
  realpathSync(mkdtempSync(join(tmpdir(), 'watch-root-')));

function recordingFire(): {
  fire: FireTrigger;
  calls: Array<[Trigger, FireContext]>;
} {
  const calls: Array<[Trigger, FireContext]> = [];
  const fire: FireTrigger = async (t, ctx): Promise<FireResult> => {
    calls.push([t, ctx]);
    return { fired: true, jobId: 'j', runId: 'r' };
  };
  return { fire, calls };
}

/** A capturing Logger seam — records every log line so a test can assert a
 *  warning was emitted (and read its fields). */
function captureLogger(): {
  log: Logger;
  lines: Array<{
    level: string;
    msg: string;
    fields?: Record<string, unknown>;
  }>;
} {
  const lines: Array<{
    level: string;
    msg: string;
    fields?: Record<string, unknown>;
  }> = [];
  const rec =
    (level: string) => (msg: string, fields?: Record<string, unknown>) => {
      lines.push({ level, msg, fields });
    };
  return {
    log: {
      debug: rec('debug'),
      info: rec('info'),
      warn: rec('warn'),
      error: rec('error'),
    },
    lines,
  };
}

// ---- tests ----------------------------------------------------------------

test('an add event fires the matching file trigger with {{file.path}} in vars', () => {
  const root = realRoot();
  const store = newStore();
  const t = store.create({
    name: 'csv-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv') },
  });
  const chok = fakeChokidar();
  const { fire, calls } = recordingFire();
  const w = createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  });
  w.start();

  const matched = join(root, 'x.csv');
  chok.emit(matched, 'add', matched);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0].id).toBe(t.id);
  expect(calls[0]?.[1]).toEqual({
    reason: 'file',
    vars: { 'file.path': matched },
  });
});

test('passes chokidar the awaitWriteFinish + ignoreInitial + depth:0 options', () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'csv-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv') },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  }).start();

  expect(chok.calls).toHaveLength(1);
  expect(chok.calls[0]?.opts).toEqual({
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    ignoreInitial: true,
    depth: 0,
    followSymlinks: false,
  });
});

test('honours the configured events list (change only → no add fire)', () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'watch-change',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv'), events: [FileEventKind.Change] },
  });
  const chok = fakeChokidar();
  const { fire, calls } = recordingFire();
  createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  }).start();

  const matched = join(root, 'x.csv');
  chok.emit(matched, 'add', matched); // not subscribed → ignored
  expect(calls).toHaveLength(0);
  chok.emit(matched, 'change', matched);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1].reason).toBe('file');
});

test('skips disabled and non-file triggers', () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'disabled-file',
    type: TriggerType.File,
    enabled: false,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv') },
  });
  store.create({
    name: 'a-cron',
    type: TriggerType.Cron,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '* * * * *' },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  }).start();
  expect(chok.calls).toHaveLength(0);
});

test('skips an unconfinable path without crashing start()', () => {
  const root = realRoot();
  const store = newStore();
  // path outside the confinement root → confineWatchPath throws → skipped.
  store.create({
    name: 'escapes',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: '/etc/passwd' },
  });
  store.create({
    name: 'ok',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'ok.csv') },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  expect(() =>
    createFileWatcher({
      triggerStore: store,
      fire,
      watchRoot: root,
      watch: chok.watch,
    }).start(),
  ).not.toThrow();
  // Only the confinable trigger got a watcher.
  expect(chok.calls).toHaveLength(1);
  expect(chok.calls[0]?.path).toBe(join(root, 'ok.csv'));
});

test('start() is idempotent (a double-start does not double-watch)', () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'csv-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv') },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  const w = createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  });
  w.start();
  w.start();
  expect(chok.calls).toHaveLength(1);
});

test('stop() closes every open watcher', async () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'a',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'a.csv') },
  });
  store.create({
    name: 'b',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'b.csv') },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  const w = createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  });
  w.start();
  await w.stop();
  expect(chok.closed.sort()).toEqual(
    [join(root, 'a.csv'), join(root, 'b.csv')].sort(),
  );
});

test('creates a missing watch root (default ~-style) private on start', () => {
  // A watchRoot dir that does not exist yet must be created 0700 on start (I4)
  // so confineWatchPath's realpathSync(root) succeeds.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'watch-parent-')));
  const root = join(parent, 'inbox');
  const store = newStore();
  store.create({
    name: 'csv-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: join(root, 'x.csv') },
  });
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
  }).start();
  const { statSync } = require('node:fs') as typeof import('node:fs');
  const st = statSync(root);
  expect(st.isDirectory()).toBe(true);
  expect(st.mode & 0o777).toBe(0o700);
  expect(chok.calls).toHaveLength(1);
});

// A single REAL-chokidar smoke test proves the wiring end-to-end (no seam): a
// file created in the watched dir fires the trigger with its absolute path.
// awaitWriteFinish is the production 400ms threshold — a single ~1s test.
test('REAL chokidar: creating a file in the watched dir fires the trigger', async () => {
  const root = realRoot();
  const store = newStore();
  store.create({
    name: 'real-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: root }, // watch the confined dir itself (depth:0)
  });
  const fired: FireContext[] = [];
  let resolveFired: (() => void) | undefined;
  const done = new Promise<void>((res) => {
    resolveFired = res;
  });
  const fire: FireTrigger = async (_t, ctx): Promise<FireResult> => {
    fired.push(ctx);
    resolveFired?.();
    return { fired: true, jobId: 'j', runId: 'r' };
  };
  const w = createFileWatcher({ triggerStore: store, fire, watchRoot: root });
  w.start();
  try {
    // Give chokidar a moment to arm, then create a file.
    await new Promise((r) => setTimeout(r, 200));
    const created = join(root, 'dropped.csv');
    writeFileSync(created, 'hello');
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('no fire within 5s')), 5000),
    );
    await Promise.race([done, timeout]);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.reason).toBe('file');
    expect(fired[0]?.vars?.['file.path']).toBe(created);
  } finally {
    await w.stop();
  }
}, 10000);

// followSymlinks:false — an in-root symlink pointing OUTSIDE must not extend the
// watch: a file created at the symlink TARGET (physically outside the root)
// never fires. Real chokidar so the option is actually honored end-to-end.
test('REAL chokidar: followSymlinks:false — a file at an in-root symlink target does not fire', async () => {
  const root = realRoot();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')));
  symlinkSync(outside, join(root, 'link-out')); // in-root symlink → outside dir
  const store = newStore();
  store.create({
    name: 'link-inbox',
    type: TriggerType.File,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: root }, // watch the confined dir itself (depth:0)
  });
  const { fire, calls } = recordingFire();
  const w = createFileWatcher({ triggerStore: store, fire, watchRoot: root });
  w.start();
  try {
    await new Promise((r) => setTimeout(r, 300)); // let chokidar arm
    // Create a file at the OUTSIDE target of the in-root symlink.
    const outsideFile = join(outside, 'evil.csv');
    writeFileSync(outsideFile, 'x');
    // Wait well past awaitWriteFinish — a fire (if any) would have happened.
    await new Promise((r) => setTimeout(r, 900));
    // followSymlinks:false must NOT descend into the symlink target: no fired
    // path is the physically-outside file (chokidar treats the in-root symlink
    // node itself as a plain entry, never following it outward).
    const firedPaths = calls.map(([, ctx]) => ctx.vars?.['file.path']);
    expect(firedPaths).not.toContain(outsideFile);
    expect(firedPaths.some((p) => p?.startsWith(outside))).toBe(false);
  } finally {
    await w.stop();
  }
}, 10000);

// FIX 3 — a pre-existing loosely-permissioned root is NOT re-chmod'd (we don't
// own it) but MUST emit a warning naming the path + perms.
test('warns (does not chmod) when a pre-existing root has loose perms', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'loose-parent-')));
  const root = join(parent, 'inbox');
  mkdirSync(root, { mode: 0o755 }); // pre-existing group/world-accessible dir
  const store = newStore();
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  const cap = captureLogger();
  createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
    log: cap.log,
  }).start();
  const warn = cap.lines.find(
    (l) => l.level === 'warn' && l.msg.includes('loose permissions'),
  );
  expect(warn).toBeDefined();
  expect(warn?.fields?.root).toBe(root);
  expect(warn?.fields?.mode).toBe('755');
  // Warn-only: the dir's perms are left untouched (not auto-chmod'd to 0700).
  expect(statSync(root).mode & 0o777).toBe(0o755);
});

// FIX 4 — an unwritable/invalid root must NOT crash start(); it warns, skips the
// watches, and leaves `started` false so a later start() can retry (proven by a
// second start() re-attempting → emitting a second warning, not short-circuiting).
test('an un-mkdir-able root: start() does not throw, started stays false (retry possible)', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'bad-parent-')));
  const asFile = join(parent, 'not-a-dir');
  writeFileSync(asFile, ''); // a FILE where a dir parent is needed
  const root = join(asFile, 'inbox'); // mkdir(recursive) → ENOTDIR
  const store = newStore();
  const chok = fakeChokidar();
  const { fire } = recordingFire();
  const cap = captureLogger();
  const w = createFileWatcher({
    triggerStore: store,
    fire,
    watchRoot: root,
    watch: chok.watch,
    log: cap.log,
  });
  expect(() => w.start()).not.toThrow();
  expect(chok.calls).toHaveLength(0); // no watches armed
  const unavailable = () =>
    cap.lines.filter(
      (l) => l.level === 'warn' && l.msg.includes('watch root unavailable'),
    );
  expect(unavailable()).toHaveLength(1);
  // `started` did NOT latch true → a second start() retries (guard would have
  // silently returned without a second warning had it latched).
  expect(() => w.start()).not.toThrow();
  expect(unavailable()).toHaveLength(2);
});
