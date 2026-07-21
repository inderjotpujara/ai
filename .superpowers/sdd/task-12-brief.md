### Task 12: watcher.ts — file triggers (HARD §7.4)

**Files:**
- Create: `src/triggers/watcher.ts`, `src/triggers/confine.ts`
- Test: `tests/triggers/watcher.test.ts`, `tests/triggers/confine.test.ts`
- Dep: `bun add chokidar@4`

**Interfaces:**
- Consumes: `chokidar` (default import); `FireTrigger` (Task 9); `TriggerStore`; `FileConfig`, `TriggerType` from `./types.ts`; `loadConfig` for `AGENT_TRIGGERS_WATCH_ROOT`.
- Produces:
  - `src/triggers/confine.ts`:
    - `expandHome(p: string): string` — expands a leading `~` (bare or `~/…`) against `os.homedir()`: `p.replace(/^~(?=$|\/)/, homedir())`; any other string passes through. The default `AGENT_TRIGGERS_WATCH_ROOT` (`~/.agent/inbox`) is stored with a literal `~` (schema.ts, I4) and expanded HERE at the read site, mirroring the `~/…` config-default convention (`AGENT_MEDIA_VENV` et al.). This is the ONLY place `~` is resolved, so a literal `~` never reaches `realpathSync`.
    - `confineWatchPath(candidate: string, baseDir: string): string` — resolve `candidate` (via `realpathSync` when it exists, else `resolve`), REJECT (throw `WatchPathError`) if the resolved path is the filesystem root, is not under `realpathSync(baseDir)`, or escapes via symlink; return the confined absolute path. Mirrors `confineToDir` in `src/server/security/media-path.ts`. (Callers pass an ALREADY-`expandHome`d `baseDir`.)
  - `src/triggers/watcher.ts`: `createFileWatcher(deps: { triggerStore: TriggerStore; fire: FireTrigger; watchRoot: string; watch?: typeof chokidar.watch }): { start(): void; stop(): Promise<void> }`. On `start()` it FIRST resolves `const root = expandHome(deps.watchRoot)` and ensures the dir exists (`mkdirSync(root, { recursive: true, mode: 0o700 })` — created private on first watcher start, I4) BEFORE confining any trigger path under `root`.

- [ ] **Step 1: Write the failing tests.** Confinement (pure, no chokidar):

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { confineWatchPath, expandHome, WatchPathError } from '../../src/triggers/confine.ts';
// realpathSync the base so the assertions hold on macOS (tmpdir is a /var → /private/var symlink).
const realBase = () => realpathSync(mkdtempSync(join(tmpdir(), 'wr-')));
test('rejects the filesystem root', () => {
  expect(() => confineWatchPath('/', realBase())).toThrow(WatchPathError);
});
test('rejects a path outside the watch root', () => {
  expect(() => confineWatchPath('/etc/passwd', realBase())).toThrow(WatchPathError);
});
test('accepts a path under the watch root (real, confined dir)', () => {
  const base = realBase();
  writeFileSync(join(base, 'x.csv'), '');
  expect(confineWatchPath(join(base, 'x.csv'), base)).toBe(join(base, 'x.csv'));
});
// I4: expandHome resolves the leading ~ against the real home; a literal ~
// never survives to reach realpathSync/confineWatchPath.
test('expandHome resolves the default watch root against home', () => {
  expect(expandHome('~/.agent/inbox')).toBe(join(homedir(), '.agent/inbox'));
  expect(expandHome('/abs/path')).toBe('/abs/path'); // non-~ passes through
});
```

  Watcher (inject a fake `watch` returning a stub emitter so no real fs events fire):

```ts
test('an add event fires the matching file trigger with {{file.path}} in vars', async () => {
  // fake chokidar.watch → emitter; simulate .emit('add', '/Users/me/inbox/x.csv');
  // assert deps.fire called with { reason: 'file', vars: { 'file.path': '/Users/me/inbox/x.csv' } }
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `confine.ts` per the Produces spec (`expandHome` + `confineWatchPath` + `WatchPathError`).
  - `watcher.ts`: on `start()`, FIRST `const root = expandHome(deps.watchRoot)` then `mkdirSync(root, { recursive: true, mode: 0o700 })` (create the confinement root private on first start, I4 — so the default `~/.agent/inbox` exists and `realpathSync(root)` in `confineWatchPath` succeeds). Then gather all enabled `TriggerType.File` triggers; for each, `confineWatchPath((config as FileConfig).path, root)` (re-check at watch time even though create-time also confined — defense in depth, §7.4), then `chokidar.watch(confinedPath, { awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }, ignoreInitial: true, depth: 0 })`. On the configured events (default `['add']`), call `deps.fire(trigger, { reason: 'file', vars: { 'file.path': matchedPath } })`. Keep one watcher per trigger in a map; `stop()` awaits `.close()` on all. A trigger whose path fails confinement is skipped with a logged warning (never crashes `start()`).
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/watcher.ts src/triggers/confine.ts tests/triggers/watcher.test.ts tests/triggers/confine.test.ts`.

```bash
git add src/triggers/watcher.ts src/triggers/confine.ts tests/triggers/watcher.test.ts tests/triggers/confine.test.ts package.json bun.lock
git commit -m "feat(triggers): file watcher (chokidar4) with path confinement"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.4). Reviewer probes: symlink escape (a link under `baseDir` pointing to `/etc`), `..` traversal, and that confinement runs at BOTH create-time and watch-time.*

