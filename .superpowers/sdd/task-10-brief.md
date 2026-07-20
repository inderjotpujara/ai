## Task 10: `GET /api/daemon/logs` — redacted tail (§7.3) [ADVERSARIAL-VERIFY §7.3]

> **⚠ ADVERSARIAL-VERIFY (§7.3b — logs tail must not exfiltrate the disaster secret).** **Naive failure mode:** `cat`-ing the raw log file — a logged request/error line can contain the 64-hex root token or a `Bearer <session-token>`, so the tail would leak the durable root or a session token over HTTP. **Mechanism:** a redaction pass replacing `[0-9a-f]{64}` and `Bearer\s+\S+` with `‹redacted›` BEFORE returning bytes, AND a hard `tail ≤ 2000` cap (from the contract, T5) so it can't stream an unbounded file. **Acceptance test (mandatory):** write a log line containing a 64-hex token and a `Bearer eyJ…` and assert `lines[]` contains `‹redacted›` and NOT the secret substrings.

**Files:**
- Create: `src/server/daemon/redact.ts` (`redactSecrets`)
- Create: `src/server/daemon/logs.ts` (the handler)
- Modify: `src/server/app.ts` (route + `ServerDeps.daemonLogDir`)
- Modify: `src/daemon/spans.ts` (`recordDaemonLogsRead`)
- Test: `tests/server/daemon/redact.test.ts` (new), `tests/server/daemon/logs.test.ts` (new)

**Interfaces:**
- Consumes: `DaemonLogsQuerySchema`/`DaemonLogsResponseSchema` (T5).
- Produces: `redactSecrets(line: string): string`; `handleDaemonLogs(params: URLSearchParams, deps: { daemonLogDir: string }): Response` → `DaemonLogsResponse` (last-N redacted lines of `agent.{out,err}.log`); `ServerDeps.daemonLogDir: string`. Route `GET /api/daemon/logs`.

- [ ] **Step 1: Write the failing redaction test** — `tests/server/daemon/redact.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { redactSecrets } from '../../../src/server/daemon/redact.ts';

test('redacts a 64-hex token', () => {
  const hex = 'a'.repeat(64);
  const out = redactSecrets(`booted with root ${hex} ok`);
  expect(out).not.toContain(hex);
  expect(out).toContain('‹redacted›');
});

test('redacts a Bearer session token', () => {
  const out = redactSecrets('auth: Bearer eyJhbGciOi.payload.sig extra');
  expect(out).not.toContain('eyJhbGciOi.payload.sig');
  expect(out).toContain('Bearer ‹redacted›');
});

test('leaves a clean line untouched', () => {
  expect(redactSecrets('run-123 finished ok')).toBe('run-123 finished ok');
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/daemon/redact.ts`**:
```typescript
const REDACTED = '‹redacted›';

/**
 * Strip any durable-root-token-shaped (`[0-9a-f]{64}`) or `Bearer <token>`
 * substring from a log line before it leaves the host over HTTP (§7.3). The
 * root token is the disaster-if-leaked secret and a session token authenticates
 * a device — neither may ever appear in a tail response. The hex pass runs
 * FIRST so a `Bearer <64hex>` has its hex redacted too; the Bearer pass then
 * collapses any remaining `Bearer <opaque>` (e.g. a base64url.payload.sig).
 */
export function redactSecrets(line: string): string {
  return line
    .replace(/\b[0-9a-f]{64}\b/gi, REDACTED)
    .replace(/Bearer\s+\S+/g, `Bearer ${REDACTED}`);
}
```

- [ ] **Step 4: Write the failing logs test** — `tests/server/daemon/logs.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDaemonLogs } from '../../../src/server/daemon/logs.ts';

function tempLogDir() {
  const dir = mkdtempSync(join(tmpdir(), 'logs-'));
  const hex = 'b'.repeat(64);
  writeFileSync(join(dir, 'agent.out.log'),
    `line1\nBearer eyJ.payload.sig\nroot ${hex}\nline4\n`);
  writeFileSync(join(dir, 'agent.err.log'), 'err-a\nerr-b\n');
  return { dir, hex };
}

test('returns the last N redacted lines of the out stream', async () => {
  const { dir, hex } = tempLogDir();
  const res = handleDaemonLogs(new URLSearchParams('tail=2&stream=out'), { daemonLogDir: dir });
  const body = await res.json();
  expect(body.lines).toHaveLength(2);
  expect(body.lines.join('\n')).not.toContain(hex);
  expect(body.lines.join('\n')).not.toContain('eyJ.payload.sig');
});

test('selects the err stream', async () => {
  const { dir } = tempLogDir();
  const res = handleDaemonLogs(new URLSearchParams('stream=err'), { daemonLogDir: dir });
  const body = await res.json();
  expect(body.lines).toContain('err-a');
});

test('a bad tail value is a 400', async () => {
  const { dir } = tempLogDir();
  expect(handleDaemonLogs(new URLSearchParams('tail=99999'), { daemonLogDir: dir }).status).toBe(400);
});

test('a missing log file yields an empty lines array (not a 500)', async () => {
  const res = handleDaemonLogs(new URLSearchParams(), { daemonLogDir: join(tmpdir(), 'no-such-dir') });
  const body = await res.json();
  expect(body.lines).toEqual([]);
});
```

- [ ] **Step 5: Implement `src/server/daemon/logs.ts`**:
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { DaemonLogsQuerySchema, DaemonLogsResponseSchema } from '../../contracts/index.ts';
import { recordDaemonLogsRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { redactSecrets } from './redact.ts';

export type DaemonLogsDeps = { daemonLogDir: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/daemon/logs?tail=&stream=out|err` — a REDACTED tail of
 * `~/.agent/logs/agent.{out,err}.log`. Every returned line runs through
 * `redactSecrets` (§7.3) so the root/session token can never leak over HTTP,
 * and `tail` is capped at 2000 by the schema so this can't stream an unbounded
 * file. A missing/unreadable log file collapses to an empty `lines` array
 * (degrade, never 500) — a not-yet-booted daemon simply has no logs.
 */
export function handleDaemonLogs(params: URLSearchParams, deps: DaemonLogsDeps): Response {
  let query: ReturnType<typeof DaemonLogsQuerySchema.parse>;
  try {
    query = DaemonLogsQuerySchema.parse({
      tail: params.get('tail') ?? undefined,
      stream: params.get('stream') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }
  const file = join(deps.daemonLogDir, `agent.${query.stream}.log`);
  let lines: string[] = [];
  try {
    const raw = readFileSync(file, 'utf8');
    const all = raw.split('\n').filter((l) => l.length > 0);
    lines = all.slice(-query.tail).map(redactSecrets);
  } catch {
    lines = []; // absent/unreadable → no logs yet (degrade, never crash)
  }
  recordDaemonLogsRead();
  return json(DaemonLogsResponseSchema.parse({ lines }), 200);
}
```

- [ ] **Step 6: Add the span helper** — in `src/daemon/spans.ts`:
```typescript
/** Record a daemon-logs tail read as a `daemon.logs.read` span. */
export function recordDaemonLogsRead(): void {
  const span = tracer().startSpan('daemon.logs.read');
  span.end();
}
```

- [ ] **Step 7: Wire the route + ServerDeps** — in `src/server/app.ts`: add `daemonLogDir` as **OPTIONAL** (`?:`, same rationale as T8/T9):
```typescript
  /** Directory holding `agent.{out,err}.log` for the redacted tail. Optional —
   *  the /api/daemon/logs route degrades to 503 when unset. */
  daemonLogDir?: string;
```
Import `handleDaemonLogs` and the `need` helper (T8). Add the route, guarding the optional dep via `need`:
```typescript
        if (req.method === 'GET' && url.pathname === '/api/daemon/logs') {
          const res = handleDaemonLogs(new URLSearchParams(url.search), {
            daemonLogDir: need(deps.daemonLogDir, 'daemonLogDir'),
          });
          rec.status(res.status);
          return res;
        }
```
(Real population is T11: `daemonLogDir: join(dirname(defaultPidPath()), 'logs')` at the `main.ts` deps site, matching `src/cli/daemon.ts`'s `defaultLogDir()`. Optional field ⇒ no typecheck error to work around before then.)

- [ ] **Step 8: Run — verify green** — `bun test tests/server/daemon/redact.test.ts tests/server/daemon/logs.test.ts` → PASS.

- [ ] **Step 9: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/daemon/redact.ts src/server/daemon/logs.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/daemon/redact.test.ts tests/server/daemon/logs.test.ts
git add src/server/daemon/ src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/daemon/
git commit -m "feat(server): GET /api/daemon/logs redacted tail (Slice 25b Incr 2, §7.3)"
```

