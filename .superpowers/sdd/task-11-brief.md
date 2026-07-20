## Task 11: Wire the new `ServerDeps` fields in `main.ts` + the daemon injection

**Files:**
- Modify: `src/server/main.ts` (populate `queueConcurrency`, `daemonPidPath`, `bindInfo`, `daemonLogDir` on the `deps` object; expose them for injected mode)
- Modify: `src/cli/daemon.ts` (`buildRealDaemon` — ensure the injected `startWebServer` path carries the same values)
- Test: `tests/server/main-ops-deps.test.ts` (new — a light assertion that a booted `ServerDeps` carries the four fields)

**Interfaces:**
- Consumes: `computeConcurrency` (`src/queue/concurrency.ts`), `defaultPidPath` (`src/daemon/pid.ts`), the existing `bind`/`allowedHosts`/`port` locals in `startWebServer` (`src/server/main.ts:~198`), `cfg.AGENT_WEB_SESSION_TTL_MS`.
- Produces: a fully-populated `ServerDeps` with `queueConcurrency`, `daemonPidPath`, `bindInfo`, `daemonLogDir` — so the T8/T9/T10 routes have real values in BOTH standalone and daemon-injected boot.

- [ ] **Step 1: Consolidate the wiring** — in `src/server/main.ts`, where `deps: ServerDeps` is built (line ~355), add the four fields (some may already be there as minimal stubs from T8–T10 — consolidate to the canonical values):
```typescript
    queueConcurrency: injected ? injectedConcurrency : computeConcurrency(),
    daemonPidPath: opts.daemonPidPath ?? defaultPidPath(),
    bindInfo: {
      bind,
      allowedHosts,
      port,
      sessionTtlMs: opts.sessionTtlMs ?? (cfg.AGENT_WEB_SESSION_TTL_MS as number),
    },
    daemonLogDir: opts.daemonLogDir ?? join(dirname(defaultPidPath()), 'logs'),
```
Add `daemonPidPath?: string` and `daemonLogDir?: string` to `startWebServer`'s options type (`StartOptions`), and thread the injected pool's concurrency: when `opts.queue` is injected the daemon knows its own `computeConcurrency()` value — extend the injected-queue option to `queue?: { jobStore; pool; concurrency: number }` and read `injectedConcurrency = injected?.concurrency ?? computeConcurrency()`. Update `src/daemon/core.ts`'s `startWebServer({ queue: { jobStore, pool } })` call to `{ queue: { jobStore: opts.queue, pool: opts.pool, concurrency: opts.concurrency } }` and add `concurrency: number` to `CreateDaemonOptions`; `src/cli/daemon.ts buildRealDaemon` passes `concurrency: computeConcurrency()` (the SAME value it built the pool with — hoist it to a local so pool + daemon share one number).

- [ ] **Step 2: Write + run the deps test** — `tests/server/main-ops-deps.test.ts`: boot `startWebServer` with a temp runs/queue root + `staticDir` stub (mirror the existing `tests/server/main*.test.ts` boot fixture), then assert the served instance answers `GET /api/daemon/status` and `GET /api/queue/stats` with 200s (proving the deps are populated end-to-end). Run → PASS.

- [ ] **Step 3: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/main.ts src/cli/daemon.ts src/daemon/core.ts tests/server/main-ops-deps.test.ts
git add src/server/main.ts src/cli/daemon.ts src/daemon/core.ts tests/server/main-ops-deps.test.ts
git commit -m "feat(server): wire queueConcurrency/pidPath/bindInfo/logDir into ServerDeps (Slice 25b Incr 2)"
```

