## Task 9: `pid.readStartedAt` + extend `GET /api/daemon/status` (uptime + bind) [ADVERSARIAL-VERIFY §7.3]

> **⚠ ADVERSARIAL-VERIFY (§7.3a — uptime robust to who answers).** **Naive failure mode:** deriving uptime from `process.uptime()` of whatever process answers the request — correct ONLY because the server runs in-daemon today, and silently wrong the moment status is ever proxied or the web server is split from the daemon. **Mechanism:** `startedAt = statSync(pidPath).mtimeMs` (the daemon's own pid write, `daemon/pid.ts`) with `uptimeMs = Date.now() - startedAt` — robust to who answers because it reads the daemon's on-disk boot marker, not the responder's process clock. **Acceptance test:** inject a pid file with a known mtime and assert `uptimeMs` derived from it (not from `process.uptime()`).

**Files:**
- Modify: `src/daemon/pid.ts` (add `readStartedAt`)
- Create: `src/server/daemon/status.ts` (the handler)
- Modify: `src/server/app.ts` (route + `ServerDeps.daemonPidPath` + `ServerDeps.bindInfo`)
- Modify: `src/daemon/spans.ts` (`recordDaemonStatusRead`)
- Test: `tests/daemon/pid-started-at.test.ts` (new), `tests/server/daemon/status.test.ts` (new)

**Interfaces:**
- Consumes: `readLivePid` (`src/daemon/pid.ts:77`), `DaemonStatusDtoSchema`/`DaemonBindDtoSchema` (T3), `OriginPolicy` (`src/server/security/origin.ts:1`).
- Produces: `readStartedAt(path: string): number | undefined` (pid file mtime, `undefined` if absent); `handleDaemonStatus(deps: { daemonPidPath; bindInfo }): Response` → `DaemonStatusDTO`; `ServerDeps.daemonPidPath: string`; `ServerDeps.bindInfo: { bind: string; allowedHosts: string[]; port: number; sessionTtlMs: number }`. Route `GET /api/daemon/status`.

- [ ] **Step 1: Write the failing pid test** — `tests/daemon/pid-started-at.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStartedAt } from '../../src/daemon/pid.ts';

test('readStartedAt returns the pid file mtime in epoch-ms', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writeFileSync(path, '4242');
  const when = new Date('2026-07-19T00:00:00Z');
  utimesSync(path, when, when);
  expect(readStartedAt(path)).toBe(when.getTime());
});

test('readStartedAt returns undefined when the pid file is absent', () => {
  expect(readStartedAt(join(tmpdir(), 'nope-does-not-exist.pid'))).toBeUndefined();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `readStartedAt`** — add to `src/daemon/pid.ts`:
```typescript
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
// ... existing ...

/**
 * The daemon's boot instant, derived from the pid file's mtime (§7.3): the
 * pid is written ONCE at `start()`, so its mtime is the daemon's boot time —
 * robust to WHICH process answers a status request (the responder's own
 * `process.uptime()` would be wrong the moment status is ever proxied). Returns
 * `undefined` when the file is absent/unreadable (every failure → "unknown").
 */
export function readStartedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Write the failing status test** — `tests/server/daemon/status.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDaemonStatus } from '../../../src/server/daemon/status.ts';

const bindInfo = { bind: '127.0.0.1', allowedHosts: ['ts.example'], port: 4130, sessionTtlMs: 100 };

test('reports running + pid + uptime derived from the pid mtime, plus bind', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  writeFileSync(path, String(process.pid)); // a LIVE pid so readLivePid keeps it
  const when = Date.now() - 5000;
  utimesSync(path, new Date(when), new Date(when));
  const res = handleDaemonStatus({ daemonPidPath: path, bindInfo });
  const body = await res.json();
  expect(body.running).toBe(true);
  expect(body.pid).toBe(process.pid);
  expect(body.uptimeMs).toBeGreaterThanOrEqual(4000); // ~5s, derived from mtime
  expect(body.bind).toEqual(bindInfo);
});

test('reports not-running with no pid/uptime when the pid file is absent', async () => {
  const res = handleDaemonStatus({ daemonPidPath: join(tmpdir(), 'absent.pid'), bindInfo });
  const body = await res.json();
  expect(body.running).toBe(false);
  expect(body.pid).toBeUndefined();
  expect(body.uptimeMs).toBeUndefined();
});
```

- [ ] **Step 5: Implement `src/server/daemon/status.ts`**:
```typescript
import { DaemonStatusDtoSchema } from '../../contracts/index.ts';
import { readLivePid, readStartedAt } from '../../daemon/pid.ts';
import { recordDaemonStatusRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type DaemonStatusDeps = {
  daemonPidPath: string;
  bindInfo: { bind: string; allowedHosts: string[]; port: number; sessionTtlMs: number };
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/daemon/status` — the Overview daemon card. Liveness from
 * `readLivePid` (clears a stale pid), uptime from the pid file's mtime (§7.3 —
 * robust to who answers, NOT `process.uptime()`), plus the bind posture the
 * Devices tab renders. Read-only: there is NO remote start/stop (D6).
 */
export function handleDaemonStatus(deps: DaemonStatusDeps): Response {
  const pid = readLivePid(deps.daemonPidPath);
  const startedAt = pid !== undefined ? readStartedAt(deps.daemonPidPath) : undefined;
  const uptimeMs = startedAt !== undefined ? Date.now() - startedAt : undefined;
  recordDaemonStatusRead();
  return json(
    DaemonStatusDtoSchema.parse({
      running: pid !== undefined,
      pid,
      startedAt,
      uptimeMs,
      bind: deps.bindInfo,
    }),
    200,
  );
}
```

- [ ] **Step 6: Add the span helper** — in `src/daemon/spans.ts`:
```typescript
/** Record an Overview-tab daemon-status read as a `daemon.status.read` span. */
export function recordDaemonStatusRead(): void {
  const span = tracer().startSpan('daemon.status.read');
  span.end();
}
```

- [ ] **Step 7: Wire the route + ServerDeps** — in `src/server/app.ts`: add both fields as **OPTIONAL** (`?:`, same rationale as `queueConcurrency` in T8 — no fixture-ripple, no temp stub):
```typescript
  /** Daemon pid-file path (for uptime from mtime, §7.3). Optional — the
   *  /api/daemon/status route degrades to 503 when unset. */
  daemonPidPath?: string;
  /** Bind posture the Overview/Devices tabs render. Optional (as above). */
  bindInfo?: { bind: string; allowedHosts: string[]; port: number; sessionTtlMs: number };
```
Import `handleDaemonStatus` and the `need` helper (T8). Add the route (before the logs route, grouped with the daemon reads), building the deps via `need` so a missing field degrades to 503 and the narrowed object typechecks against `DaemonStatusDeps`:
```typescript
        if (req.method === 'GET' && url.pathname === '/api/daemon/status') {
          const res = handleDaemonStatus({
            daemonPidPath: need(deps.daemonPidPath, 'daemonPidPath'),
            bindInfo: need(deps.bindInfo, 'bindInfo'),
          });
          rec.status(res.status);
          return res;
        }
```
(Real population in `main.ts`/daemon is T11: `daemonPidPath: opts.pidPath ?? defaultPidPath()` and `bindInfo: { bind, allowedHosts, port, sessionTtlMs: <cfg.AGENT_WEB_SESSION_TTL_MS> }` — `bind`/`allowedHosts`/`port` are already in scope there. With the fields optional there is no typecheck error to work around before then.)

- [ ] **Step 8: Run — verify green** — `bun test tests/daemon/pid-started-at.test.ts tests/server/daemon/status.test.ts` → PASS.

- [ ] **Step 9: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/daemon/pid.ts src/server/daemon/status.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/daemon/pid-started-at.test.ts tests/server/daemon/status.test.ts
git add src/daemon/pid.ts src/server/daemon/status.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/daemon/ tests/server/daemon/
git commit -m "feat(server): GET /api/daemon/status uptime(from pid mtime)+bind (Slice 25b Incr 2, §7.3)"
```

