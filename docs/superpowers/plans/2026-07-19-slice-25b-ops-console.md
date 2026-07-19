# Slice 25b — Jobs & Triggers Ops Console (web-UI companion to Slice 24) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute strictly top-to-bottom; each task's **Interfaces** block names the exact signatures the next task consumes, so parallel implementers stay aligned. Full design (authoritative): [`../specs/2026-07-19-slice-25b-ops-console-design.md`](../specs/2026-07-19-slice-25b-ops-console-design.md).

**Goal:** Add a browser **Ops console** to the existing local web UI (`web/`) that operates the Slice-24 daemon + SQLite job queue + durable auth for real — one new top-level **Ops** nav entry at `/ops` with four roving-tabindex tabs: **Overview** (daemon/queue health + redacted logs tail), **Jobs** (queue table + drawer + cancel/resume/retry), **Triggers** (designed, STUBBED until Slice 25), and **Devices & Access** (bind posture, per-device pairing with URL+QR, revoke, break-glass root rotate).

**Architecture:** Backend gap-filling first — new read endpoints (`GET /api/queue/stats`, extend `GET /api/daemon/status`, `GET /api/daemon/logs`), then the biggest new surface: a persisted **device registry** (`~/.agent/devices.json`, the first *positive* device list beside the existing negative `revoked-devices.json`) with a **trusted-local** privileged-write gate fronting pairing/revoke/rotate-root (`src/server/devices/`, `src/server/security/{trusted-local,rotate}.ts`), plus a lineage-preserving `POST /api/jobs/:id/retry`. Then the web console (`web/src/features/ops/`) mirrors `web/src/features/runs/` conventions exactly (`apiFetch` + zod contract schemas, automatic Bearer, `RegionErrorBoundary` per panel, `data-testid="area-ops"`). No triggers backend, no remote daemon start/stop (bootstrap paradox — the daemon hosts this very server), no charts this slice.

**Tech Stack:** Root/server: Bun + TypeScript (`bun:test`), `bun:sqlite` (WAL), Zod v4, `node:crypto` (`randomUUID`/`timingSafeEqual`/`createHmac`), OpenTelemetry via `src/telemetry/spans.ts`. Web: React 19 / Vite / Tailwind v4 / TanStack Router / `@ai-sdk/react`, `vitest` + `happy-dom` + `@testing-library/react` + `vitest-axe`. A bundled `qrcode` npm dep in `web/` for the self-contained (Vite-bundled, NOT a CDN) pairing QR.

## Global Constraints (govern every task — copied verbatim from the spec)

- **Package manager:** `bun`, never `npm`. Root/server tests use `bun:test` (`import { test, expect, describe } from 'bun:test'`). Web tests use `vitest` (`import { describe, it, expect, vi } from 'vitest'`). Never cross the two.
- **Per-task gate before every commit** (all three, every task): `bun run typecheck` (clean) + `bun run lint:file -- <files>` (0 errors) + the task's focused tests. `bun test` does NOT typecheck and the pre-commit hook is `docs:check` only — run all three yourself. **Web tasks** gate with `cd web && bun run typecheck && bun run test`; **server/root tasks** gate with the root `bun run typecheck && bun run lint:file -- <files> && bun test <file>`. Run the full **`bun run check`** at every increment boundary (the "Boundary gate" task).
- **Code style:** `type` over `interface`; **`enum` over string-literal unions** for finite named sets (string enums only — `enum Foo { A = 'A' }`); discriminated object unions stay `type`; early returns over nested conditionals; small focused files; descriptive names; no `console.log`. Strict TS — `noUncheckedIndexedAccess` is ON (index access is `T | undefined`; guard it). Explicit `.ts`/`.tsx` import extensions.
- **Contracts (`src/contracts/**`) are isomorphic:** import only `zod` (and sibling contract files); no `.strict()`; pair `export const XSchema` with `export type X = z.infer<typeof XSchema>`. Enums live in `src/contracts/enums.ts` and import nothing. Every new wire enum gets a parity test if it mirrors an engine enum (precedent: `job-kind-parity.test.ts`).
- **Loopback-default:** `AGENT_WEB_BIND` defaults to `127.0.0.1` (no implicit `0.0.0.0`); remote reach is an explicit opt-in via `AGENT_WEB_ALLOWED_HOSTS` + `AGENT_WEB_ORIGIN_ALLOWLIST`. "The network is not the trust boundary."
- **Session-guard on EVERY `/api` route:** the existing `SessionGuard.verify` (`buildFetch` in `src/server/app.ts:151`) already fronts every `/api` path except the beacon; every new route inherits it. Do NOT add a route that bypasses it.
- **Trusted-local gate on device mutations:** pairing / revoke / rotate-root additionally require `requireTrustedLocal(req, guard, policy)` returning `null` (principal `'local'` + loopback/allowed origin) ON TOP of the session guard — a remote paired device can never mint/revoke/rotate. `rotate-root` additionally re-confirms the root secret (constant-time compare).
- **No remote daemon start/stop:** the daemon hosts this web server; the Devices/Overview tabs show copy-the-CLI-command guidance (`agent daemon stop`) — there is NO remote-stop button anywhere.
- **QR generator self-contained / no CDN (per CSP):** the pairing QR is produced by the Vite-bundled `qrcode` dependency (self-contained in the app bundle, never a `<script src="cdn…">`).
- **Never hardcode model choices / budgets / limits / intervals / concurrency / N** — compute live; env vars are fallback-only. New knobs go in `src/config/schema.ts` as documented `ConfigEntry` rows. The poll cadence reuses `notifyConfig().pollMs`; concurrency reuses `computeConcurrency()`.
- **Docs hard line (non-negotiable, 4 surfaces + SDD ledger):** Increment 9 updates **all four living surfaces** in the same landing push — (1) `docs/architecture.md`, (2) root `README.md`, (3) `docs/ROADMAP.md`, (4) the interactive architecture-snapshot **Artifact** — plus the SDD ledger `.superpowers/sdd/progress.md`. `bun run docs:check` + the pre-push slice-landing gate hard-fail until README, ROADMAP, and the ledger are updated in the same push.
- **Branch:** `slice-25b-ops-console` (cut off `main`). Commit per task, conventional subject.

**Model-tiering note (for the executor).** Sonnet is the FLOOR for all mechanical tasks (contracts, DTO mapping, routes, web components, docs). **Opus** for the security/registry seam and shared-seam reviews: `device-registry.ts` (T13), `trusted-local.ts` (T14). **ultracode / Fable adversarial-verify** for §7.1 device-pairing security (the pair/revoke/rotate-root routes T17/T18/T19, the loopback-only local-token injection T20b, and the security acceptance suite T21) and §7.2 queue-stats race (T7), and the whole-branch capstone review (T49). Reviews are never downgraded to save budget. Track live budget with `bunx ccusage@latest blocks --active` at each increment boundary; the official `/usage` panel is the authoritative meter.

## Shared contracts (defined ONCE — every task's Interfaces block references these verbatim)

These are the canonical NEW/EXTENDED contract shapes. They are introduced by concrete tasks (cited), but stated here so all nine increments stay type-consistent. Do not redefine or drift them.

**Extended `JobDtoSchema`** (`src/contracts/dto.ts`, T1) — adds two fields to the existing schema:
```typescript
// ... existing fields (id, kind, payload, priority, status, attempts,
// maxAttempts, createdAt, updatedAt, startedAt?, finishedAt?, runId?,
// result?, error?) UNCHANGED, plus:
  availableAt: z.number(),          // epoch-ms claim floor (D2 — retry-scheduled-at)
  retriedFrom: z.string().nullable(), // §11 lineage: the job id this is a retry of (null if original)
```

**Extended `RunListQuerySchema`** (`src/contracts/requests.ts`, T2) — adds one facet:
```typescript
  origin: z.enum(RunOrigin).optional(),   // server-filter runs by provenance (RunOrigin.Daemon)
```

**Daemon status + bind DTOs** (`src/contracts/dto.ts`, T3):
```typescript
export const DaemonBindDtoSchema = z.object({
  bind: z.string(),                 // AGENT_WEB_BIND (loopback vs LAN/tunnel interface)
  allowedHosts: z.array(z.string()),// AGENT_WEB_ALLOWED_HOSTS (+ the bind interface)
  port: z.number(),
  sessionTtlMs: z.number(),         // AGENT_WEB_SESSION_TTL_MS
});
export type DaemonBindDTO = z.infer<typeof DaemonBindDtoSchema>;

export const DaemonStatusDtoSchema = z.object({
  running: z.boolean(),
  pid: z.number().optional(),
  startedAt: z.number().optional(), // epoch-ms, from the pid file's mtime (§7.3)
  uptimeMs: z.number().optional(),  // Date.now() - startedAt
  bind: DaemonBindDtoSchema,
});
export type DaemonStatusDTO = z.infer<typeof DaemonStatusDtoSchema>;
```

**Queue stats DTO** (`src/contracts/dto.ts`, T3):
```typescript
export const QueueStatsDtoSchema = z.object({
  counts: z.record(z.enum(JobStatusWire), z.number()), // per-status row counts (one snapshot)
  total: z.number(),                 // sum(counts) — invariant: equals sum every read (§7.2)
  activeCount: z.number(),           // pool.activeCount() — in-flight controllers (distinct field)
  concurrency: z.number(),           // computeConcurrency()
});
export type QueueStatsDTO = z.infer<typeof QueueStatsDtoSchema>;
```

**Device DTOs + pairing requests** (`src/contracts/dto.ts` + `src/contracts/requests.ts`, T4):
```typescript
// dto.ts
export const DeviceDtoSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  createdAt: z.number(),
  exp: z.number(),                  // session-token expiry epoch-ms (never the token itself)
});
export type DeviceDTO = z.infer<typeof DeviceDtoSchema>;

export const DeviceListResponseSchema = z.object({ items: z.array(DeviceDtoSchema) });
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;

// requests.ts
export const DevicePairRequestSchema = z.object({ label: z.string().min(1).max(120) });
export type DevicePairRequest = z.infer<typeof DevicePairRequestSchema>;

export const DevicePairResponseSchema = z.object({
  deviceId: z.string(),
  token: z.string(),                // transmitted EXACTLY ONCE, never persisted/re-listed
  pairingUrl: z.string(),           // phone-openable URL carrying the token in its #fragment
});
export type DevicePairResponse = z.infer<typeof DevicePairResponseSchema>;

export const RotateRootRequestSchema = z.object({ rootSecret: z.string() }); // D5 re-confirm
export type RotateRootRequest = z.infer<typeof RotateRootRequestSchema>;
```

**Daemon logs query/response** (`src/contracts/requests.ts`, T5):
```typescript
export const DaemonLogsQuerySchema = z.object({
  tail: z.coerce.number().int().positive().max(2000).default(200),
  stream: z.enum(['out', 'err']).default('out'),
});
export type DaemonLogsQuery = z.infer<typeof DaemonLogsQuerySchema>;

export const DaemonLogsResponseSchema = z.object({ lines: z.array(z.string()) });
export type DaemonLogsResponse = z.infer<typeof DaemonLogsResponseSchema>;
```

**Device registry** (`src/server/security/device-registry.ts`, T13):
```typescript
export type DeviceRecord = { deviceId: string; label: string; createdAt: number; exp: number };
export type DeviceRegistry = {
  list(now?: number): DeviceRecord[];   // prunes expired (exp <= now) on read, persisting the prune
  append(rec: DeviceRecord): void;      // add a freshly-paired device
  remove(deviceId: string): void;       // drop on revoke
  clear(): void;                        // drop ALL (rotate-root mass-invalidation)
};
export function createDeviceRegistry(config: { path?: string }): DeviceRegistry;
// default path ~/.agent/devices.json, dir 0700 / file 0600 (sibling to daemon-token / revoked-devices.json)
```

**Trusted-local gate** (`src/server/security/trusted-local.ts`, T14):
```typescript
// Returns a 403 Response when the request is NOT the trusted local principal,
// else null. `guard.principal(req) === 'local'` (the local-minted session
// token's deviceId) AND a loopback / AGENT_WEB_ALLOWED_HOSTS host+origin.
export function requireTrustedLocal(
  req: Request,
  guard: SessionGuard,      // src/server/security/token.ts
  policy: OriginPolicy,     // src/server/security/origin.ts
): Response | null;
```

**Root token rotate helper** (`src/server/security/rotate.ts`, T19) — thin orchestrator over the existing stores:
```typescript
export function rotateRoot(deps: {
  rootTokens: RootTokenStore;         // root-token.ts (rotate())
  sessionTokens: SessionTokenStore;   // session-token.ts (mintSessionToken)
  sessionTtlMs: number;
}): { localToken: string };           // re-mints the local ('local') session so the operator tab survives
```

**New telemetry attribute** (`src/telemetry/spans.ts` `ATTR`, T15): `DEVICE_ID: 'device.id'` — the target device of a pair/revoke. New spans (via `inSpan`/`ATTR`, no-op without a tracer): `ops.devices.pair`, `ops.devices.revoke`, `security.rotate-root`, `daemon.status.read`, `queue.stats.read`, `daemon.logs.read` — server-request-scoped, nesting under `withServerRequestSpan`.

**Web contract alias:** the SPA imports these via the `@contracts` alias (e.g. `import { QueueStatsDtoSchema } from '@contracts'`), same as `RunListResponseSchema` in `web/src/features/runs/index.tsx`.

---

# Increment 1 — Contracts + DTO deltas (the shared seam, FIRST)

**Purpose (spec §5.1, §11):** land every new/extended contract shape + the retry-lineage data column so all later tasks compile against stable types. Parity tests stay green. Sonnet floor throughout — mechanical, isomorphic.

## Task 1: `JobDto.availableAt` + `JobDto.retriedFrom` + `retried_from` column + store lineage plumbing

**Files:**
- Modify: `src/contracts/dto.ts` (add two fields to `JobDtoSchema`)
- Modify: `src/queue/migrations.ts` (append an `'add-retried-from'` migration)
- Modify: `src/queue/types.ts` (`JobRecord.retriedFrom`, `JobInput.retriedFrom`)
- Modify: `src/queue/store.ts` (`JobRowRaw.retried_from`, `toJobRecord`, `enqueue` INSERT)
- Test: `tests/queue/migrations.test.ts` (extend), `tests/queue/store-lineage.test.ts` (new), `tests/contracts/job-dto.test.ts` (extend or new)

**Interfaces:**
- Consumes: `JobDtoSchema` (`src/contracts/dto.ts:131`), `JOB_MIGRATIONS` (`src/queue/migrations.ts`), `JobRecord`/`JobInput` (`src/queue/types.ts`), `createJobStore` (`src/queue/store.ts:112`).
- Produces: `JobDtoSchema` with `availableAt: z.number()` + `retriedFrom: z.string().nullable()` (Shared contracts); `JobRecord.retriedFrom: string | null`; `JobInput.retriedFrom?: string`; `JobStore.enqueue` persists `retried_from`. `toJobDto` (`src/server/jobs/map.ts`) is an unchanged passthrough `JobDtoSchema.parse(record)` — it works once `JobRecord` carries `availableAt` (already there) + `retriedFrom`.

- [ ] **Step 1: Write the failing store test** — `tests/queue/store-lineage.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('a fresh job has retriedFrom null', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { input: 'go' } });
  expect(job.retriedFrom).toBeNull();
  expect(store.getJob(job.id)?.retriedFrom).toBeNull();
  store.close();
});

test('enqueue stamps retriedFrom when supplied (lineage)', () => {
  const store = tempStore();
  const original = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const retry = store.enqueue({
    kind: JobKind.Crew,
    payload: 1,
    retriedFrom: original.id,
  });
  expect(retry.retriedFrom).toBe(original.id);
  expect(store.getJob(retry.id)?.retriedFrom).toBe(original.id);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/queue/store-lineage.test.ts` → FAIL (`retriedFrom` is `undefined`, not `null`, and `JobInput` has no `retriedFrom`).

- [ ] **Step 3: Implement the migration** — append to `JOB_MIGRATIONS` in `src/queue/migrations.ts` (AFTER the existing `'init-jobs'` entry, so `user_version` advances to 2):
```typescript
  {
    name: 'add-retried-from',
    up: (db: Database) => {
      // §11 lineage: a retried job records the id of the job it re-runs, so the
      // Jobs drawer can show "retry of job X" and back-link. Nullable — original
      // (non-retry) jobs have no lineage.
      db.run(`ALTER TABLE jobs ADD COLUMN retried_from TEXT`);
    },
  },
```

- [ ] **Step 4: Implement the type + store changes.**
  - `src/queue/types.ts`: add `retriedFrom: string | null;` to `JobRecord` (after `error`), and `retriedFrom?: string;` to `JobInput` (after `runId`).
  - `src/queue/store.ts`: add `retried_from: string | null;` to `JobRowRaw`; in `toJobRecord` add `retriedFrom: r.retried_from,` (SQLite yields `string | null` directly — no `?? undefined` since the DTO field is `nullable`, not optional); change the `enqueue` INSERT to include the column:
```typescript
    db.run(
      `INSERT OR IGNORE INTO jobs
       (id, kind, payload, priority, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, available_at,
        run_id, result, error, retried_from)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?)`,
      [
        id,
        input.kind,
        JSON.stringify(input.payload),
        priority,
        max,
        at,
        at,
        availableAt,
        runId,
        input.retriedFrom ?? null,
      ],
    );
```

- [ ] **Step 5: Extend the migration test** — in `tests/queue/migrations.test.ts`, update the `init-jobs` column assertion's expected version to `2` and add `'retried_from'` to the expected `cols` array (last element); add:
```typescript
test('add-retried-from advances user_version to 2', () => {
  const db = new Database(':memory:');
  expect(migrate(db, JOB_MIGRATIONS)).toBe(2);
});
```

- [ ] **Step 6: Extend the contract** — in `src/contracts/dto.ts`, add to `JobDtoSchema` (after `error`):
```typescript
  availableAt: z.number(),
  retriedFrom: z.string().nullable(),
```
Add a round-trip assertion in `tests/contracts/job-dto.test.ts` (create if absent):
```typescript
import { test, expect } from 'bun:test';
import { JobDtoSchema } from '../../src/contracts/dto.ts';

test('JobDtoSchema round-trips availableAt + nullable retriedFrom', () => {
  const dto = {
    id: 'job-1', kind: 'crew', payload: { input: 'x' }, priority: 'normal',
    status: 'queued', attempts: 0, maxAttempts: 3, createdAt: 1, updatedAt: 1,
    availableAt: 0, retriedFrom: null,
  };
  expect(JobDtoSchema.parse(dto).retriedFrom).toBeNull();
  expect(JobDtoSchema.parse({ ...dto, retriedFrom: 'job-0' }).retriedFrom).toBe('job-0');
});
```

- [ ] **Step 7: Run — verify green** — `bun test tests/queue/store-lineage.test.ts tests/queue/migrations.test.ts tests/contracts/job-dto.test.ts` → PASS.

- [ ] **Step 8: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/queue/migrations.ts src/queue/types.ts src/queue/store.ts tests/queue/store-lineage.test.ts tests/queue/migrations.test.ts tests/contracts/job-dto.test.ts
git add src/contracts/dto.ts src/queue/migrations.ts src/queue/types.ts src/queue/store.ts tests/queue/
git commit -m "feat(queue): JobDto availableAt + retriedFrom lineage column (Slice 25b Incr 1)"
```

## Task 2: `RunListQuery.origin` facet

**Files:**
- Modify: `src/contracts/requests.ts` (`RunListQuerySchema`)
- Modify: `src/server/runs/list.ts` (thread the facet into the run-list filter)
- Test: `tests/contracts/run-list-query.test.ts` (new), `tests/server/runs/list-origin.test.ts` (new)

**Interfaces:**
- Consumes: `RunListQuerySchema` (`src/contracts/requests.ts:80`), `RunOrigin` (`src/contracts/enums.ts:11`), `handleRunList` (`src/server/runs/list.ts`).
- Produces: `RunListQuerySchema.origin: z.enum(RunOrigin).optional()`; `handleRunList` passes `origin` to its run-store list filter so `?origin=daemon` returns only `RunOrigin.Daemon` runs (the Jobs-tab `runId` deep-link filter).

- [ ] **Step 1: Write the failing contract test** — `tests/contracts/run-list-query.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { RunListQuerySchema } from '../../src/contracts/requests.ts';
import { RunOrigin } from '../../src/contracts/enums.ts';

test('RunListQuery accepts an origin facet', () => {
  expect(RunListQuerySchema.parse({ origin: 'daemon' }).origin).toBe(RunOrigin.Daemon);
});
test('RunListQuery origin is optional and rejects an unknown value', () => {
  expect(RunListQuerySchema.parse({}).origin).toBeUndefined();
  expect(() => RunListQuerySchema.parse({ origin: 'nope' })).toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/contracts/run-list-query.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `src/contracts/requests.ts`, add to `RunListQuerySchema` (after `kind`):
```typescript
  origin: z.enum(RunOrigin).optional(),
```
Add `RunOrigin` to the enums import at the top of the file. In `src/server/runs/list.ts`, read `query.origin` and pass it into the same run-store filter the `kind` facet uses (locate the existing list-filter call and add an `origin` predicate — daemon-list filtering matches on the run dir's `origin` marker, same source `mapRunToDto` reads). If the run store's list function has no `origin` param yet, filter the mapped `RunListItemDTO[]` by `item.origin === query.origin` before pagination (mirroring how a purely in-mapper facet would work) — keep it a straight equality filter.

- [ ] **Step 4: Write + run the server test** — `tests/server/runs/list-origin.test.ts`: seed two run dirs (one daemon-origin, one manual — reuse the run-fixture helper the existing `tests/server/runs/*` tests use), call `handleRunList(new URLSearchParams('origin=daemon'), deps)`, assert only the daemon run returns. Run → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts src/server/runs/list.ts tests/contracts/run-list-query.test.ts tests/server/runs/list-origin.test.ts
git add src/contracts/requests.ts src/server/runs/list.ts tests/contracts/run-list-query.test.ts tests/server/runs/list-origin.test.ts
git commit -m "feat(contracts): RunListQuery.origin facet for daemon-run filtering (Slice 25b Incr 1)"
```

## Task 3: Daemon status/bind + queue stats DTOs

**Files:**
- Modify: `src/contracts/dto.ts` (`DaemonBindDtoSchema`, `DaemonStatusDtoSchema`, `QueueStatsDtoSchema`)
- Test: `tests/contracts/daemon-queue-dto.test.ts` (new)

**Interfaces:**
- Consumes: `JobStatusWire` (`src/contracts/enums.ts:221`).
- Produces: `DaemonBindDtoSchema`, `DaemonStatusDtoSchema`, `QueueStatsDtoSchema` (+ their `z.infer` type exports) EXACTLY as in Shared contracts.

- [ ] **Step 1: Write the failing test** — `tests/contracts/daemon-queue-dto.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import {
  DaemonStatusDtoSchema,
  QueueStatsDtoSchema,
} from '../../src/contracts/dto.ts';

test('DaemonStatusDto round-trips with bind + optional uptime', () => {
  const dto = DaemonStatusDtoSchema.parse({
    running: true, pid: 42, startedAt: 1000, uptimeMs: 500,
    bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
  });
  expect(dto.bind.port).toBe(4130);
  expect(DaemonStatusDtoSchema.parse({
    running: false, bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
  }).pid).toBeUndefined();
});

test('QueueStatsDto keeps activeCount distinct from counts.running', () => {
  const dto = QueueStatsDtoSchema.parse({
    counts: { running: 2 }, total: 2, activeCount: 1, concurrency: 4,
  });
  expect(dto.activeCount).toBe(1);
  expect(dto.counts.running).toBe(2);
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/contracts/daemon-queue-dto.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add the three schemas to `src/contracts/dto.ts` (verbatim from Shared contracts). Add `JobStatusWire` to the enums import if not present (it already is, line 9).

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/daemon-queue-dto.test.ts
git add src/contracts/dto.ts tests/contracts/daemon-queue-dto.test.ts
git commit -m "feat(contracts): DaemonStatus/DaemonBind/QueueStats DTOs (Slice 25b Incr 1)"
```

## Task 4: Device DTOs + pairing requests + rotate-root request

**Files:**
- Modify: `src/contracts/dto.ts` (`DeviceDtoSchema`, `DeviceListResponseSchema`)
- Modify: `src/contracts/requests.ts` (`DevicePairRequestSchema`, `DevicePairResponseSchema`, `RotateRootRequestSchema`)
- Test: `tests/contracts/device-dto.test.ts` (new)

**Interfaces:**
- Produces: `DeviceDtoSchema`/`DeviceListResponseSchema` (dto.ts) + `DevicePairRequestSchema`/`DevicePairResponseSchema`/`RotateRootRequestSchema` (requests.ts) EXACTLY as in Shared contracts.

- [ ] **Step 1: Write the failing test** — `tests/contracts/device-dto.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { DeviceListResponseSchema } from '../../src/contracts/dto.ts';
import { DevicePairRequestSchema } from '../../src/contracts/requests.ts';

test('DeviceListResponse round-trips a device row', () => {
  const r = DeviceListResponseSchema.parse({
    items: [{ deviceId: 'd1', label: 'phone', createdAt: 1, exp: 2 }],
  });
  expect(r.items[0]?.label).toBe('phone');
});
test('DevicePairRequest rejects an empty label and caps at 120 chars', () => {
  expect(() => DevicePairRequestSchema.parse({ label: '' })).toThrow();
  expect(() => DevicePairRequestSchema.parse({ label: 'x'.repeat(121) })).toThrow();
  expect(DevicePairRequestSchema.parse({ label: 'ok' }).label).toBe('ok');
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement** — add `DeviceDtoSchema` + `DeviceListResponseSchema` to `dto.ts`; add `DevicePairRequestSchema` + `DevicePairResponseSchema` + `RotateRootRequestSchema` to `requests.ts` (verbatim from Shared contracts).

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts tests/contracts/device-dto.test.ts
git add src/contracts/dto.ts src/contracts/requests.ts tests/contracts/device-dto.test.ts
git commit -m "feat(contracts): Device DTOs + pair/rotate-root requests (Slice 25b Incr 1)"
```

## Task 5: Daemon logs query/response contract

**Files:**
- Modify: `src/contracts/requests.ts` (`DaemonLogsQuerySchema`, `DaemonLogsResponseSchema`)
- Test: `tests/contracts/daemon-logs.test.ts` (new)

**Interfaces:**
- Produces: `DaemonLogsQuerySchema` (coerces `tail`, caps at 2000, defaults 200; `stream` enum `['out','err']` default `'out'`) + `DaemonLogsResponseSchema` (verbatim from Shared contracts).

- [ ] **Step 1: Write the failing test** — `tests/contracts/daemon-logs.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { DaemonLogsQuerySchema } from '../../src/contracts/requests.ts';

test('DaemonLogsQuery coerces tail, applies defaults, caps at 2000', () => {
  expect(DaemonLogsQuerySchema.parse({}).tail).toBe(200);
  expect(DaemonLogsQuerySchema.parse({}).stream).toBe('out');
  expect(DaemonLogsQuerySchema.parse({ tail: '50' }).tail).toBe(50);
  expect(() => DaemonLogsQuerySchema.parse({ tail: '3000' })).toThrow();
  expect(() => DaemonLogsQuerySchema.parse({ stream: 'both' })).toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement** — add both schemas to `requests.ts` (verbatim from Shared contracts). Note the `z.enum(['out','err'])` inline literal follows the existing `EdgeDtoSchema` precedent (`dto.ts:256`) for a wire-only two-value set with no engine mirror.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts tests/contracts/daemon-logs.test.ts
git add src/contracts/requests.ts tests/contracts/daemon-logs.test.ts
git commit -m "feat(contracts): DaemonLogs query/response (Slice 25b Incr 1)"
```

## Task 6: Boundary gate — Increment 1

**Files:** none (verification only).

- [ ] **Step 1: Full gate** — `bun run check` → PASS (docs-check · typecheck · lint · tests). All contract parity tests green; the `jobs` migration is now at `user_version = 2`; no `src/**` runtime behaviour changed yet beyond the additive column/facet. Record the running test count for the Artifact footer later.

---

# Increment 2 — Read endpoints (queue stats · daemon status+uptime · redacted logs)

**Purpose (spec §5.2, D1, D6, §7.2, §7.3):** the read half of the Ops surface. A single-query `JobStore.stats()` (§7.2 race-free), the extended `GET /api/daemon/status` (uptime from pid mtime + bind, §7.3), and `GET /api/daemon/logs` (redacted tail, §7.3). Each route inherits the session guard; each emits its span. New `ServerDeps` fields are added here and wired in `main.ts` + the daemon (T11).

## Task 7: `JobStore.stats()` — single-query per-status counts (§7.2 race-free) [OPUS / ultracode ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY (§7.2 — queue-stats accuracy under live concurrency).** **Naive failure mode:** computing per-status counts as six separate `COUNT(*) WHERE status=?` reads while the worker pool concurrently transitions rows (`Queued→Running→Done`) — the six snapshots are taken at different instants, so `sum(counts) ≠ total` and a job is double-counted or missed. **Mechanism:** ONE `SELECT status, COUNT(*) … GROUP BY status` inside the store's normal synchronous read (one consistent `bun:sqlite` snapshot). `activeCount` is reported SEPARATELY by the route (from `pool.activeCount()`), NEVER reconciled with the DB `running` count by arithmetic. **Acceptance test (Step 1 below) is mandatory and must not be softened:** enqueue + drive N jobs through a live pool and assert, on repeated `stats()` calls, `sum(counts.values) === total` EVERY time and no count is negative.

**Files:**
- Modify: `src/queue/store.ts` (add `stats()` to the returned closure)
- Test: `tests/queue/store-stats.test.ts` (new)

**Interfaces:**
- Consumes: the Task-6 `db` + `JobStatus` (`src/queue/types.ts`).
- Produces: `stats(): { counts: Record<JobStatus, number>; total: number }` on `JobStore` — one `GROUP BY status` read; `counts` has an entry for EVERY `JobStatus` value (missing statuses default to `0`); `total = sum(counts)`.

- [ ] **Step 1: Write the failing race-consistency test** — `tests/queue/store-stats.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('stats() reports every JobStatus with zero-defaults and total=sum', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const s = store.stats();
  // Every status key present (zero-defaulted), even the ones with no rows.
  for (const status of Object.values(JobStatus)) {
    expect(typeof s.counts[status]).toBe('number');
  }
  expect(s.counts[JobStatus.Queued]).toBe(2);
  expect(s.total).toBe(2);
  store.close();
});

test('sum(counts) === total on EVERY read while a pool churns rows (§7.2)', async () => {
  const store = tempStore();
  for (let i = 0; i < 40; i++) store.enqueue({ kind: JobKind.Chat, payload: i });
  const pool = createWorkerPool({
    store, concurrency: 4, pollMs: 1,
    dispatch: () => async () => ({ ok: true }),
  });
  pool.start();
  // Hammer stats() while the pool transitions rows underneath it.
  for (let i = 0; i < 200; i++) {
    const s = store.stats();
    const sum = Object.values(s.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.total);            // never off-by-one across a transition
    for (const v of Object.values(s.counts)) expect(v).toBeGreaterThanOrEqual(0);
    await Bun.sleep(0);
  }
  await pool.stop();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/queue/store-stats.test.ts` → FAIL (`stats` is not a function).

- [ ] **Step 3: Implement `stats()`** — add inside `createJobStore` and to the returned object:
```typescript
  function stats(): { counts: Record<JobStatus, number>; total: number } {
    // ONE read, ONE consistent snapshot: a single GROUP BY over the whole
    // table, so the six per-status counts are all taken at the SAME instant.
    // Six separate COUNT(*) reads would each see a different mid-transition
    // moment (§7.2), breaking sum(counts) === total. bun:sqlite is synchronous,
    // so this query is atomic w.r.t. any interleaved claimNext/markDone write.
    const rows = db
      .query(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)
      .all() as { status: string; n: number }[];
    // Zero-default EVERY status so the wire DTO always has all keys (the panel
    // renders a fixed row set; a missing key would render as blank, not 0).
    const counts = Object.fromEntries(
      Object.values(JobStatus).map((s) => [s, 0]),
    ) as Record<JobStatus, number>;
    let total = 0;
    for (const r of rows) {
      // Guard an unknown status value defensively (never NaN the sum).
      if (r.status in counts) counts[r.status as JobStatus] = r.n;
      total += r.n;
    }
    return { counts, total };
  }
```
Add `stats,` to the returned object literal. Import `JobStatus` as a VALUE (not just a type) in `src/queue/store.ts` — it is currently imported `type JobStatus`; change to `import { ..., JobStatus, ... }` so `Object.values(JobStatus)` works at runtime.

- [ ] **Step 4: Run — verify green** — `bun test tests/queue/store-stats.test.ts` → PASS (2 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-stats.test.ts
git add src/queue/store.ts tests/queue/store-stats.test.ts
git commit -m "feat(queue): race-free single-query JobStore.stats() (Slice 25b Incr 2, §7.2)"
```

## Task 8: `GET /api/queue/stats` route + `toQueueStatsDto` + app.ts wiring + telemetry

**Files:**
- Create: `src/server/queue/stats.ts` (the handler)
- Modify: `src/server/app.ts` (route + `ServerDeps.queueConcurrency`)
- Modify: `src/daemon/spans.ts` (add `recordQueueStatsRead`) — or a new `src/server/queue/spans.ts`; keep it in `daemon/spans.ts` beside the other queue spans
- Test: `tests/server/queue/stats.test.ts` (new)

**Interfaces:**
- Consumes: `JobStore.stats()` (T7), `WorkerPool.activeCount()` (`src/queue/pool.ts:27`), `QueueStatsDtoSchema` (T3), `ServerDeps` (`src/server/app.ts:66`).
- Produces: `handleQueueStats(deps: { jobStore; pool; queueConcurrency }): Response` → `QueueStatsDTO` (`counts`+`total` from `stats()`, `activeCount` from `pool.activeCount()`, `concurrency` from `deps.queueConcurrency`). `ServerDeps.queueConcurrency: number`. Route `GET /api/queue/stats`.

- [ ] **Step 1: Write the failing test** — `tests/server/queue/stats.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleQueueStats } from '../../../src/server/queue/stats.ts';

test('GET /api/queue/stats reports counts + activeCount + concurrency', async () => {
  const jobStore = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  jobStore.enqueue({ kind: JobKind.Crew, payload: 1 });
  const pool = { activeCount: () => 0 } as { activeCount(): number };
  const res = handleQueueStats({ jobStore, pool, queueConcurrency: 4 });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total).toBe(1);
  expect(body.counts.queued).toBe(1);
  expect(body.concurrency).toBe(4);
  expect(body.activeCount).toBe(0);
  jobStore.close();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement `src/server/queue/stats.ts`**:
```typescript
import { QueueStatsDtoSchema } from '../../contracts/index.ts';
import type { WorkerPool } from '../../queue/pool.ts';
import type { JobStore } from '../../queue/store.ts';
import { recordQueueStatsRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type QueueStatsDeps = {
  jobStore: JobStore;
  pool: Pick<WorkerPool, 'activeCount'>;
  queueConcurrency: number;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `GET /api/queue/stats` — queue health for the Overview tab. `counts`+`total`
 * come from the store's SINGLE race-free snapshot (§7.2); `activeCount` is the
 * pool's in-flight controller count, reported as a SEPARATE field (never
 * reconciled by arithmetic with the DB `running` count — they may transiently
 * differ, and the panel labels them "running rows" vs "active workers").
 */
export function handleQueueStats(deps: QueueStatsDeps): Response {
  const { counts, total } = deps.jobStore.stats();
  recordQueueStatsRead();
  return json(
    QueueStatsDtoSchema.parse({
      counts,
      total,
      activeCount: deps.pool.activeCount(),
      concurrency: deps.queueConcurrency,
    }),
    200,
  );
}
```

- [ ] **Step 4: Add the span helper** — in `src/daemon/spans.ts`, add (following the `recordJobEnqueue` no-op pattern):
```typescript
/** Record an Overview-tab queue-health read as a `queue.stats.read` span. */
export function recordQueueStatsRead(): void {
  const span = tracer().startSpan('queue.stats.read');
  span.end();
}
```

- [ ] **Step 5: Wire the route + ServerDeps (with the shared optional-dep degrade helper)** — in `src/server/app.ts`:
  - Add `queueConcurrency` to `ServerDeps` as **OPTIONAL** (`?:`), matching the `runLimiter?`/`sessionTokens?`/`staticDir?` precedent (documented: "worker-pool concurrency for the Overview queue card; `computeConcurrency()` value, threaded from main.ts/daemon"):
```typescript
  /** Worker-pool concurrency for the Overview queue card (`computeConcurrency()`,
   *  threaded from main.ts/daemon). Optional — the /api/queue/stats route degrades
   *  to 503 when unset (legacy fixtures need not set it). */
  queueConcurrency?: number;
```
  Making it optional is what lets this task's `ServerDeps` change compile before T11/T20 populate the real value, and keeps the ≥12 existing `const deps: ServerDeps = {…}` fixtures compiling **unedited** (FIX: no fixture-ripple, no temporary stub needed). The Slice-25b ops fields (`queueConcurrency`, `daemonPidPath`, `bindInfo`, `daemonLogDir` — T9/T10 — and `deviceRegistry`, `rootTokens`, `publicBaseUrl` — T15) are ALL optional for this reason.
  - Introduce the **shared assert-present helper + 503 degrade** ONCE here (reused by every ops route that reads an optional dep — T9/T10/T16-T20). At module scope in `app.ts`:
```typescript
/** A Slice-25b ops dep was not wired (the field is optional on ServerDeps so
 *  legacy fixtures need not set it). A route that needs one degrades to 503 with
 *  a clear message rather than throwing an opaque TypeError. */
export class DepUnavailableError extends Error {
  override name = 'DepUnavailableError';
  constructor(readonly field: string) {
    super(`server dependency not configured: ${field}`);
  }
}
/** Narrow an optional ServerDeps field to its required type, or signal a 503. */
export function need<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new DepUnavailableError(field);
  return value;
}
```
  In `handleApi`'s inner `catch (err)` (the block that currently maps to a 500), add a `DepUnavailableError` branch BEFORE the generic 500 so an unwired ops dep is a clean 503:
```typescript
      } catch (err) {
        if (err instanceof DepUnavailableError) {
          rec.status(503);
          return json({ error: err.message }, 503);
        }
        // Never crash the handler: map the typed error to an actionable JSON body.
        rec.status(500);
        return json({ error: explain(err).title }, 500);
      }
```
  - Import `handleQueueStats`. Add the route inside `handleApi`, BEFORE the `/api/jobs` block for locality (order is exact-path so it doesn't matter, but group the read routes). Build the handler's deps via `need` (so a missing `queueConcurrency` → 503, and the narrowed object typechecks against `QueueStatsDeps`'s required `queueConcurrency`):
```typescript
        if (req.method === 'GET' && url.pathname === '/api/queue/stats') {
          const res = handleQueueStats({
            jobStore: deps.jobStore,
            pool: deps.pool,
            queueConcurrency: need(deps.queueConcurrency, 'queueConcurrency'),
          });
          rec.status(res.status);
          return res;
        }
```
  (Real population of `queueConcurrency` in `main.ts`/daemon lands in T11 — with the field optional there is no typecheck error to work around in the meantime, so no temporary stub is required.)

- [ ] **Step 6: Run — verify green** — `bun test tests/server/queue/stats.test.ts` → PASS. `bun run typecheck` clean.

- [ ] **Step 7: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/queue/stats.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/queue/stats.test.ts
git add src/server/queue/stats.ts src/server/app.ts src/daemon/spans.ts src/server/main.ts tests/server/queue/stats.test.ts
git commit -m "feat(server): GET /api/queue/stats + queue.stats.read span (Slice 25b Incr 2)"
```

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

## Task 12: Boundary gate — Increment 2

**Files:** none (verification only).

- [ ] **Step 1: Full gate** — `bun run check` → PASS. The three read endpoints answer live; §7.2 stats-consistency + §7.3 uptime/redaction acceptance tests are green. Re-check budget: `bunx ccusage@latest blocks --active`.

---

# Increment 3 — Device registry + pairing security (D4/D5/§7.1) + lineage retry (§11)

**Purpose (spec §5.3, D4, D5, §7.1, §11):** the biggest new backend surface — a persisted device registry, the trusted-local privileged-write gate, and the pair/revoke/rotate-root routes, plus the lineage-preserving `POST /api/jobs/:id/retry`. This is the primary **Fable** review target: pairing/revoke/rotate are privileged writes over the web. Every device-mutation route is gated by BOTH the session guard (inherited) AND `requireTrustedLocal` (which now requires a LOOPBACK Host, not merely an allowlisted tunnel host — T14), and the `'local'` token is injected into the served index only for loopback requests (T20b), so a remote client can neither present a paired remote token nor replay the injected `'local'` token over a tunnel to pair/revoke/rotate. **Opus** for the registry + trusted-local seam (T13/T14); **Fable adversarial-verify** for the three mutation routes (T17/T18/T19), the loopback-only local-token injection (T20b), and the security acceptance suite (T21).

## Task 13: `device-registry.ts` — persisted positive device list (append/list/prune/clear) [OPUS]

> **⚠ ADVERSARIAL-VERIFY (§7.1c — no token in the registry).** The registry stores ONLY `{deviceId, label, createdAt, exp}` — NEVER the minted token. A token appears exactly once, in the pair response body (T17). Prune-on-read drops expired devices so a revoked/expired device stops showing. `0600`/`0700` perms like the sibling secrets. **Acceptance:** a listed device never carries a token field; an expired device is pruned on the next `list()`.

**Files:**
- Create: `src/server/security/device-registry.ts`
- Test: `tests/server/security/device-registry.test.ts` (new)

**Interfaces:**
- Consumes: `node:fs` (`mkdirSync`/`readFileSync`/`writeFileSync`), `node:os` (`homedir`), `node:path`. Mirrors the persistence discipline of `session-token.ts` (`0600` file, `0700` dir, fail-closed on corrupt JSON).
- Produces: `DeviceRegistry` + `createDeviceRegistry` + `DeviceRecord` (Shared contracts). `list(now?)` prunes `exp <= now` and persists the prune; `append` adds; `remove` drops one; `clear` drops all.

- [ ] **Step 1: Write the failing test** — `tests/server/security/device-registry.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';

function tempRegistry() {
  return createDeviceRegistry({ path: join(mkdtempSync(join(tmpdir(), 'dev-')), 'devices.json') });
}

test('append then list returns the device (no token field ever)', () => {
  const reg = tempRegistry();
  reg.append({ deviceId: 'd1', label: 'phone', createdAt: 1, exp: Date.now() + 100_000 });
  const items = reg.list();
  expect(items).toHaveLength(1);
  expect(items[0]?.deviceId).toBe('d1');
  expect('token' in (items[0] as object)).toBe(false);
});

test('list prunes expired devices and persists the prune', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dev-')), 'devices.json');
  const reg = createDeviceRegistry({ path });
  reg.append({ deviceId: 'live', label: 'a', createdAt: 1, exp: Date.now() + 100_000 });
  reg.append({ deviceId: 'dead', label: 'b', createdAt: 1, exp: Date.now() - 1 });
  expect(reg.list().map((d) => d.deviceId)).toEqual(['live']);
  // A fresh registry over the SAME file sees the prune persisted.
  expect(createDeviceRegistry({ path }).list().map((d) => d.deviceId)).toEqual(['live']);
});

test('remove drops one device; clear drops all', () => {
  const reg = tempRegistry();
  reg.append({ deviceId: 'd1', label: 'a', createdAt: 1, exp: Date.now() + 100_000 });
  reg.append({ deviceId: 'd2', label: 'b', createdAt: 1, exp: Date.now() + 100_000 });
  reg.remove('d1');
  expect(reg.list().map((d) => d.deviceId)).toEqual(['d2']);
  reg.clear();
  expect(reg.list()).toEqual([]);
});

test('a corrupt registry file fails closed (throws at construction)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dev-')), 'devices.json');
  require('node:fs').writeFileSync(path, '{ not json');
  expect(() => createDeviceRegistry({ path })).toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement `src/server/security/device-registry.ts`**:
```typescript
/**
 * Persisted POSITIVE device registry (Slice 25b, D4) — the first positive
 * device list beside the existing NEGATIVE `revoked-devices.json`. Records only
 * `{deviceId, label, createdAt, exp}` (NEVER the minted token — that is
 * transmitted exactly once in the pair response). `list()` prunes expired rows
 * on read so a lapsed device stops appearing. `0600` file / `0700` dir, matching
 * `session-token.ts` / `root-token.ts`. Fail-closed on a corrupt file (a
 * tampered registry must not silently un-list every device).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type DeviceRecord = {
  deviceId: string;
  label: string;
  createdAt: number;
  exp: number;
};

export type DeviceRegistry = {
  list(now?: number): DeviceRecord[];
  append(rec: DeviceRecord): void;
  remove(deviceId: string): void;
  clear(): void;
};

export function defaultDeviceRegistryPath(): string {
  return join(homedir(), '.agent', 'devices.json');
}

export function createDeviceRegistry(config: { path?: string }): DeviceRegistry {
  const path = config.path ?? defaultDeviceRegistryPath();
  let devices: DeviceRecord[] = load(path);

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(devices), { mode: 0o600 });
  }

  function list(now = Date.now()): DeviceRecord[] {
    const live = devices.filter((d) => d.exp > now);
    if (live.length !== devices.length) {
      devices = live; // prune persisted so a lapsed device stops showing
      persist();
    }
    return [...devices];
  }

  return {
    list,
    append(rec: DeviceRecord): void {
      devices = [...devices.filter((d) => d.deviceId !== rec.deviceId), rec];
      persist();
    },
    remove(deviceId: string): void {
      devices = devices.filter((d) => d.deviceId !== deviceId);
      persist();
    },
    clear(): void {
      devices = [];
      persist();
    },
  };
}

/** Load the registry. Absent → `[]` (nothing paired yet). Present-but-corrupt →
 *  THROW (fail closed: a tampered/unreadable positive list must not collapse to
 *  "no devices", which would silently drop the audit trail). */
function load(path: string): DeviceRecord[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as unknown; // throws on corrupt JSON — fail closed
  if (!Array.isArray(parsed)) {
    throw new Error(`Device registry at ${path} is not a JSON array — refusing to start (fail closed).`);
  }
  return parsed.filter(
    (d): d is DeviceRecord =>
      typeof d === 'object' && d !== null &&
      typeof (d as DeviceRecord).deviceId === 'string' &&
      typeof (d as DeviceRecord).exp === 'number',
  );
}
```

- [ ] **Step 4: Run — verify green** — `bun test tests/server/security/device-registry.test.ts` → PASS (4 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/device-registry.ts tests/server/security/device-registry.test.ts
git add src/server/security/device-registry.ts tests/server/security/device-registry.test.ts
git commit -m "feat(security): persisted positive device registry (Slice 25b Incr 3, D4)"
```

## Task 14: `trusted-local.ts` — `requireTrustedLocal` gate [OPUS]

> **⚠ ADVERSARIAL-VERIFY (§7.1b — the whole point is you pair FROM the trusted local browser).** **Naive failure mode:** gating pairing only on the session guard, so ANY paired remote device can pair/revoke/rotate. **Mechanism:** the local browser's session token has `deviceId === 'local'` (minted in `main.ts`); a paired remote device has a random UUID deviceId, so `guard.principal(req) === 'local'` is the discriminator. ADD a loopback/allowed-host + origin check as belt-and-suspenders. **Acceptance:** a request whose principal is a UUID (not `'local'`) OR whose Host/Origin is a non-loopback, non-allowlisted remote → `403`; only the local principal from a loopback/allowed origin passes.

**Files:**
- Modify: `src/server/security/origin.ts` (add the shared `isLoopbackHost(req)` helper next to `hostAllowed`)
- Create: `src/server/security/trusted-local.ts`
- Test: `tests/server/security/origin-loopback.test.ts` (new — `isLoopbackHost`), `tests/server/security/trusted-local.test.ts` (new)

**Interfaces:**
- Consumes: `SessionGuard` (`src/server/security/token.ts:42`), `OriginPolicy` + `originAllowed` + the new `isLoopbackHost` (`src/server/security/origin.ts`).
- Produces: `isLoopbackHost(req: Request): boolean` (`origin.ts`) — the request's Host header names a loopback interface (`127.0.0.1`/`[::1]`/`localhost`, with or without the port), NOT merely an allowlisted tunnel host. `requireTrustedLocal(req, guard, policy): Response | null` (Shared contracts) — returns a `403` Response unless `guard.principal(req) === 'local'` **AND `isLoopbackHost(req)`** (a LOOPBACK Host specifically, so an injected `'local'` token replayed over an allowed *tunnel* host is rejected) AND `originAllowed(req, policy)`; else `null` (proceed). The same `isLoopbackHost` is reused by the loopback-only local-token injection (T20b) — one helper, one signature.

- [ ] **Step 1: Write the failing test** — `tests/server/security/trusted-local.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import type { SessionGuard } from '../../../src/server/security/token.ts';
import { requireTrustedLocal } from '../../../src/server/security/trusted-local.ts';

// A TUNNEL host that IS on the perimeter allowlist (so it passes hostAllowed /
// enforcePerimeter) but is NOT loopback — the injected-'local'-token replay
// vector requireTrustedLocal must now close.
const policy = { port: 4130, allowedOrigins: [], allowedHosts: ['ts.example'] };
const localReq = new Request('http://127.0.0.1:4130/api/devices', {
  method: 'POST', headers: { host: '127.0.0.1:4130' },
});
const remoteHostReq = new Request('http://evil.example/api/devices', {
  method: 'POST', headers: { host: 'evil.example' },
});
const tunnelReq = new Request('http://ts.example/api/devices', {
  method: 'POST', headers: { host: 'ts.example' },
});

function guardWith(principal: string | undefined): SessionGuard {
  return { verify: () => true, verifyToken: () => true, principal: () => principal };
}

test('passes for the local principal from a loopback host', () => {
  expect(requireTrustedLocal(localReq, guardWith('local'), policy)).toBeNull();
});

test('403 when the principal is a paired remote device (UUID, not "local")', () => {
  const res = requireTrustedLocal(localReq, guardWith('550e8400-e29b-41d4-a716-446655440000'), policy);
  expect(res?.status).toBe(403);
});

test('403 when the Host is a non-loopback, non-allowlisted remote', () => {
  const res = requireTrustedLocal(remoteHostReq, guardWith('local'), policy);
  expect(res?.status).toBe(403);
});

test('403 when the injected "local" token is replayed over an ALLOWED TUNNEL host (not loopback)', () => {
  // The core FIX-2 backstop: even the trusted-'local' principal is rejected
  // unless the Host is loopback — an allowlisted tunnel host is not enough.
  const res = requireTrustedLocal(tunnelReq, guardWith('local'), policy);
  expect(res?.status).toBe(403);
});

test('403 when there is no verified principal at all', () => {
  expect(requireTrustedLocal(localReq, guardWith(undefined), policy)?.status).toBe(403);
});
```

Also add `tests/server/security/origin-loopback.test.ts` for the helper:
```typescript
import { test, expect } from 'bun:test';
import { isLoopbackHost } from '../../../src/server/security/origin.ts';

const withHost = (host: string | null) =>
  new Request('http://x/api', host === null ? {} : { headers: { host } });

test('isLoopbackHost is true for loopback hosts with or without a port', () => {
  for (const h of ['127.0.0.1:4130', '127.0.0.1', 'localhost:4130', 'localhost', '[::1]:4130', '[::1]']) {
    expect(isLoopbackHost(withHost(h))).toBe(true);
  }
});

test('isLoopbackHost is false for a tunnel/LAN host and an absent Host header', () => {
  expect(isLoopbackHost(withHost('ts.example'))).toBe(false);
  expect(isLoopbackHost(withHost('100.64.0.1:4130'))).toBe(false);
  expect(isLoopbackHost(withHost(null))).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3a: Add `isLoopbackHost` to `src/server/security/origin.ts`** (next to `hostAllowed`, reusing the existing `LOCAL_HOSTS` constant):
```typescript
/** True when the request's Host header names a LOOPBACK interface — `127.0.0.1`
 *  / `[::1]` / `localhost`, with or without the `:PORT` suffix — as opposed to
 *  an allowlisted tunnel/LAN host (which `hostAllowed` also admits). The
 *  privileged-write gate (`requireTrustedLocal`) and the local-token injection
 *  (main.ts/serveStatic) key on THIS: a request arriving over an allowed tunnel
 *  is not loopback, so it can never be treated as the physically-local browser
 *  even if it presents the `'local'` session token. */
export function isLoopbackHost(req: Request): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  const bare = host.replace(/:\d+$/, ''); // strip an optional :PORT ([::1] keeps its brackets)
  return LOCAL_HOSTS.includes(bare);
}
```

- [ ] **Step 3b: Implement `src/server/security/trusted-local.ts`**:
```typescript
/**
 * Trusted-local privileged-write gate (Slice 25b, D5). Pairing / revoke /
 * rotate-root are gated by BOTH the standard session guard (inherited by every
 * /api route) AND this: the request must come from the TRUSTED LOCAL principal
 * — `guard.principal(req) === 'local'` (only the local-minted session token
 * carries deviceId 'local'; a paired remote device has a random UUID) AND a
 * LOOPBACK Host (`isLoopbackHost`, NOT merely an allowlisted tunnel host) AND a
 * same-/allowed-origin. So you pair NEW devices FROM the physically-local
 * browser, and neither a paired remote device NOR a client that replayed the
 * injected `'local'` token over a tunnel can mint/revoke/rotate. Returns a 403
 * Response on failure, else null.
 */
import { isLoopbackHost, originAllowed, type OriginPolicy } from './origin.ts';
import type { SessionGuard } from './token.ts';

export function requireTrustedLocal(
  req: Request,
  guard: SessionGuard,
  policy: OriginPolicy,
): Response | null {
  const principal = guard.principal(req);
  const trusted =
    principal === 'local' &&
    isLoopbackHost(req) && // a LOOPBACK Host specifically — an allowed tunnel host is NOT enough
    originAllowed(req, policy);
  if (trusted) return null;
  return new Response(JSON.stringify({ error: 'forbidden: trusted-local only' }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
```

- [ ] **Step 4: Run — verify green** → PASS (`trusted-local.test.ts` 5 tests incl. the tunnel-replay 403 + `origin-loopback.test.ts` 2 tests). Also run the existing `tests/server/security/origin.test.ts` to confirm the added `isLoopbackHost` export didn't disturb `hostAllowed`/`originAllowed`.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/origin.ts src/server/security/trusted-local.ts tests/server/security/origin-loopback.test.ts tests/server/security/trusted-local.test.ts
git add src/server/security/origin.ts src/server/security/trusted-local.ts tests/server/security/origin-loopback.test.ts tests/server/security/trusted-local.test.ts
git commit -m "feat(security): isLoopbackHost + requireTrustedLocal loopback-only privileged-write gate (Slice 25b Incr 3, D5)"
```

## Task 15: Ops telemetry — `ATTR.DEVICE_ID` + pair/revoke/rotate spans + ServerDeps security seam

**Files:**
- Modify: `src/telemetry/spans.ts` (add `DEVICE_ID`)
- Create: `src/server/devices/spans.ts` (`recordDevicePair`, `recordDeviceRevoke`, `recordRotateRoot`)
- Modify: `src/server/security/session-token.ts` (`rootToken` → `string | (() => string)`, resolved per-call — so a `rotate()` on the live root takes effect immediately; a captured string would keep signing/verifying with the STALE root, making rotate-root a no-op)
- Modify: `src/server/app.ts` (add `deviceRegistry`, `rootTokens`, `publicBaseUrl` to `ServerDeps` — all three **optional**, matching the existing `runLimiter?`/`sessionTokens?`/`staticDir?` precedent)
- Test: `tests/server/devices/spans.test.ts` (new)

**Interfaces:**
- Consumes: `ATTR`/`inSpan` (`src/telemetry/spans.ts:16`), `RunOrigin` (for principal tagging), `RootTokenStore` (`src/server/security/root-token.ts:28`), `DeviceRegistry` (T13).
- Produces: `ATTR.DEVICE_ID = 'device.id'`; `recordDevicePair(deviceId, principal)`, `recordDeviceRevoke(deviceId, principal)`, `recordRotateRoot(principal)` (each a no-op without a tracer; the rotate span records an event marking the mass-invalidation); `ServerDeps.deviceRegistry: DeviceRegistry`, `ServerDeps.rootTokens: RootTokenStore`, `ServerDeps.publicBaseUrl: string`.

- [ ] **Step 1: Write the failing test** — `tests/server/devices/spans.test.ts` (asserts the helpers are callable no-ops without a tracer — mirrors `tests/daemon/spans*.test.ts` if present, else a bare "does not throw"):
```typescript
import { test, expect } from 'bun:test';
import {
  recordDevicePair,
  recordDeviceRevoke,
  recordRotateRoot,
} from '../../../src/server/devices/spans.ts';

test('device/rotate span helpers are no-ops without a tracer (never throw)', () => {
  expect(() => recordDevicePair('d1', 'local')).not.toThrow();
  expect(() => recordDeviceRevoke('d1', 'local')).not.toThrow();
  expect(() => recordRotateRoot('local')).not.toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement.**
  - **Session-token root getter (Slice 25b security fix — rotate-root must actually invalidate).** In `src/server/security/session-token.ts`, change the store to resolve the root PER CALL instead of capturing it by value, so a `rotate()` on the live root is honoured by the same store the guard verifies against. **Before** (`session-token.ts:64`):
```typescript
export function createSessionTokenStore(config: {
  path: string;
  rootToken: string;
}): SessionTokenStore {
  const { path, rootToken } = config;
  // ...
      return `${payload}.${sign(rootToken, payload)}`;          // mint
  // ...
      if (!sigMatches(sign(rootToken, payload), candidateSig)) return null; // verify
```
**After** — accept a value OR a getter and resolve it on every sign/verify (existing Slice-24 callers that pass a `string` still compile — that is why it is a union):
```typescript
export function createSessionTokenStore(config: {
  path: string;
  rootToken: string | (() => string);
}): SessionTokenStore {
  const { path } = config;
  // Resolve the root PER CALL: a captured string would keep signing/verifying
  // with the STALE root after rotate() (root-token.ts overwrites the file, and
  // getOrCreateRoot re-reads it), making rotate-root a no-op on the live store.
  const currentRoot = (): string =>
    typeof config.rootToken === 'function' ? config.rootToken() : config.rootToken;
  // ...
      return `${payload}.${sign(currentRoot(), payload)}`;         // mint
  // ...
      if (!sigMatches(sign(currentRoot(), payload), candidateSig)) return null; // verify
```
`sign(rootToken: string, payload)` is unchanged (still takes a resolved string). No other Slice-24 caller changes — the union keeps `{ rootToken: '<string>' }` valid, and `main.ts` switches to the getter form in T20.
  - In `src/telemetry/spans.ts` `ATTR`, add `DEVICE_ID: 'device.id',` (near `SERVER_PRINCIPAL`).
  - Create `src/server/devices/spans.ts`:
```typescript
import { trace } from '@opentelemetry/api';
import { ATTR } from '../../telemetry/spans.ts';

const tracer = () => trace.getTracer('agent');

/** Record a device pairing (privileged write) as an `ops.devices.pair` span,
 *  carrying the authorizing principal + the NEW device's id. No-op without a
 *  tracer, exactly like the rest of the telemetry surface. */
export function recordDevicePair(deviceId: string, principal: string): void {
  const span = tracer().startSpan('ops.devices.pair');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.setAttribute(ATTR.DEVICE_ID, deviceId);
  span.end();
}

/** Record a device revoke as an `ops.devices.revoke` span. */
export function recordDeviceRevoke(deviceId: string, principal: string): void {
  const span = tracer().startSpan('ops.devices.revoke');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.setAttribute(ATTR.DEVICE_ID, deviceId);
  span.end();
}

/** Record a break-glass root rotate as a `security.rotate-root` span, with an
 *  event marking the mass session-invalidation (every OTHER device is logged
 *  out). No target DEVICE_ID — rotate invalidates all sessions at once. */
export function recordRotateRoot(principal: string): void {
  const span = tracer().startSpan('security.rotate-root');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.addEvent('all-sessions-invalidated');
  span.end();
}
```
  - In `src/server/app.ts` `ServerDeps`, add the three fields as **OPTIONAL** (`?:`) — matching the existing `runLimiter?`/`sessionTokens?`/`staticDir?` precedent, so the ≥12 existing `const deps: ServerDeps = {…}` test fixtures that don't set them keep compiling, and the T8/T9/T10 wiring in this branch compiles before T11/T20 populate the real values:
```typescript
  /** Persisted positive device registry (T13). Optional: absent in legacy
   *  fixtures; the pair/revoke/list/rotate routes degrade to 503 when unset. */
  deviceRegistry?: DeviceRegistry;
  /** The durable root-token store (root-token.ts). Optional (as above); the
   *  rotate-root route degrades to 503 when unset. Shares ONE instance with the
   *  session store's root getter (T20). */
  rootTokens?: RootTokenStore;
  /** Public base URL the pairing URL/QR (POST /api/devices) is built from —
   *  `AGENT_WEB_PUBLIC_URL` or derived from the request origin. Optional. */
  publicBaseUrl?: string;
```
Import the `DeviceRegistry` + `RootTokenStore` types. (Population is T20's wiring / T11-style main.ts addition — add them at the `main.ts` deps site: `deviceRegistry: createDeviceRegistry({ path: opts.deviceRegistryPath ?? defaultDeviceRegistryPath() })`, `rootTokens: rootStore` (hoist the `createRootTokenStore` result — currently it is scoped inside the `else` branch; lift it so it is always available), and `publicBaseUrl: opts.publicBaseUrl ?? (cfg.AGENT_WEB_PUBLIC_URL as string)`. Add an `AGENT_WEB_PUBLIC_URL` config row in T20's Step for the derivation default.)

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/telemetry/spans.ts src/server/devices/spans.ts src/server/security/session-token.ts src/server/app.ts tests/server/devices/spans.test.ts tests/server/security/session-token.test.ts
git add src/telemetry/spans.ts src/server/devices/spans.ts src/server/security/session-token.ts src/server/app.ts tests/server/devices/spans.test.ts
git commit -m "feat(telemetry): DEVICE_ID + pair/revoke/rotate-root spans + session-root getter + security seam (Slice 25b Incr 3)"
```
> **Regression guard:** run the existing `tests/server/security/session-token.test.ts` after the getter change — every current caller passes a `string`, which the `string | (() => string)` union still accepts, so those tests must stay green.

## Task 16: `GET /api/devices` — list paired devices (prune on read)

**Files:**
- Create: `src/server/devices/list.ts`
- Modify: `src/server/app.ts` (route)
- Test: `tests/server/devices/list.test.ts` (new)

**Interfaces:**
- Consumes: `DeviceRegistry` (T13), `DeviceListResponseSchema`/`DeviceDtoSchema` (T4).
- Produces: `handleDeviceList(deps: { deviceRegistry }): Response` → `DeviceListResponse` (registry `list()` mapped to `DeviceDTO`, expired pruned). Route `GET /api/devices` (session-guarded; NOT trusted-local — reading the list is not a mutation).

- [ ] **Step 1: Write the failing test** — `tests/server/devices/list.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { handleDeviceList } from '../../../src/server/devices/list.ts';

test('GET /api/devices returns the registry rows (never a token)', async () => {
  const reg = createDeviceRegistry({ path: join(mkdtempSync(join(tmpdir(), 'dev-')), 'd.json') });
  reg.append({ deviceId: 'd1', label: 'phone', createdAt: 1, exp: Date.now() + 100_000 });
  const res = handleDeviceList({ deviceRegistry: reg });
  const body = await res.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toEqual({ deviceId: 'd1', label: 'phone', createdAt: 1, exp: expect.any(Number) });
  expect('token' in body.items[0]).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/devices/list.ts`**:
```typescript
import { DeviceListResponseSchema } from '../../contracts/index.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type DeviceListDeps = { deviceRegistry: DeviceRegistry };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/** `GET /api/devices` — paired-device list for the Devices tab. Prunes expired
 *  rows on read (registry.list). Never returns a token (the registry has none). */
export function handleDeviceList(deps: DeviceListDeps): Response {
  const items = deps.deviceRegistry.list();
  return json(DeviceListResponseSchema.parse({ items }), 200);
}
```

- [ ] **Step 4: Wire the route** — in `src/server/app.ts`, import `handleDeviceList` (and `need`, T8). Add (the `POST /api/devices` pair route and the `:id/revoke` action route land in T17/T18; keep the GET here, and remember the action-sub-path-before-bare-`:id` ordering when T18 adds `:id/revoke`). `deviceRegistry` is OPTIONAL on `ServerDeps` (T15), so narrow it via `need` — this both typechecks against `DeviceListDeps`'s non-optional `deviceRegistry` and 503s when unwired:
```typescript
        if (req.method === 'GET' && url.pathname === '/api/devices') {
          const res = handleDeviceList({
            deviceRegistry: need(deps.deviceRegistry, 'deviceRegistry'),
          });
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/devices/list.ts src/server/app.ts tests/server/devices/list.test.ts
git add src/server/devices/list.ts src/server/app.ts tests/server/devices/list.test.ts
git commit -m "feat(devices): GET /api/devices list (Slice 25b Incr 3, D4)"
```

## Task 17: `POST /api/devices` — pair a new device (server-minted id, token once) [FABLE ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY / FABLE (§7.1a,c — the top security target).** **Naive failure modes this task MUST close:** (a) **IDOR** — accepting a client-supplied `deviceId` so a remote device pairs itself a fresh identity or overwrites `'local'`; the server MUST mint the id (`crypto.randomUUID()`), NEVER trust the body. (b) gating on the session guard alone so a paired remote can pair — `requireTrustedLocal` closes this. (c) re-listing/persisting the token — the registry stores only `{deviceId,label,createdAt,exp}`; the token appears ONLY in this response body. **Acceptance (folded into T21):** pair mints a server-side id, appends to the registry, returns the token exactly once; a non-`'local'`/non-loopback caller → `403`; the minted token never appears in `GET /api/devices`.

**Files:**
- Create: `src/server/devices/pair.ts`
- Modify: `src/server/app.ts` (route)
- Test: `tests/server/devices/pair.test.ts` (new)

**Interfaces:**
- Consumes: `DevicePairRequestSchema`/`DevicePairResponseSchema` (T4), `requireTrustedLocal` (T14), `SessionTokenStore.mintSessionToken` (`src/server/security/session-token.ts:39`), `DeviceRegistry.append` (T13), `recordDevicePair` (T15), `randomUUID` (`node:crypto`), `SessionGuard`, `OriginPolicy`, `ServerDeps.publicBaseUrl`/`bindInfo.sessionTtlMs`.
- Produces: `handleDevicePair(req, deps, guard): Promise<Response>` → `202 DevicePairResponse {deviceId, token, pairingUrl}` (server mints `deviceId = crypto.randomUUID()`); registry gets `{deviceId, label, createdAt, exp}`; `pairingUrl = ${publicBaseUrl}/#token=${token}`. `403` from `requireTrustedLocal`, `400` on a bad body.

- [ ] **Step 1: Write the failing test** — `tests/server/devices/pair.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';
import { handleDevicePair } from '../../../src/server/devices/pair.ts';

function deps() {
  const dir = mkdtempSync(join(tmpdir(), 'pair-'));
  const deviceRegistry = createDeviceRegistry({ path: join(dir, 'devices.json') });
  const sessionTokens = createSessionTokenStore({ path: join(dir, 'revoked.json'), rootToken: 'root-secret' });
  return {
    deviceRegistry, sessionTokens, publicBaseUrl: 'http://ts.example',
    bindInfo: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 100_000 },
    policy: { port: 4130, allowedOrigins: [], allowedHosts: [] },
  };
}
const localGuard: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'local' };
const remoteGuard: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'uuid-remote' };
const req = (body: unknown) => new Request('http://127.0.0.1:4130/api/devices', {
  method: 'POST', headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('pair mints a server-side id, returns the token once, appends to registry', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'phone' }), d, localGuard);
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/); // server-minted UUID
  expect(body.token.length).toBeGreaterThan(10);
  expect(body.pairingUrl).toBe(`http://ts.example/#token=${body.token}`);
  // Registry has the device but NEVER the token.
  const listed = d.deviceRegistry.list();
  expect(listed.map((x) => x.deviceId)).toEqual([body.deviceId]);
  expect(JSON.stringify(listed)).not.toContain(body.token);
  // The minted token actually authenticates (verifies against the store).
  expect(d.sessionTokens.verifySessionToken(body.token)?.deviceId).toBe(body.deviceId);
});

test('IDOR: a client-supplied deviceId in the body is IGNORED (server mints)', async () => {
  const d = deps();
  const res = await handleDevicePair(req({ label: 'x', deviceId: 'local' }), d, localGuard);
  const body = await res.json();
  expect(body.deviceId).not.toBe('local'); // never honours the injected id
});

test('a non-local principal is 403 (trusted-local gate)', async () => {
  const res = await handleDevicePair(req({ label: 'x' }), deps(), remoteGuard);
  expect(res.status).toBe(403);
});

test('a bad body is 400', async () => {
  const res = await handleDevicePair(req({ label: '' }), deps(), localGuard);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/devices/pair.ts`**:
```typescript
import { randomUUID } from 'node:crypto';
import { DevicePairRequestSchema, DevicePairResponseSchema } from '../../contracts/index.ts';
import type { SessionTokenStore } from '../security/session-token.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { recordDevicePair } from './spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type DevicePairDeps = {
  deviceRegistry: DeviceRegistry;
  sessionTokens: SessionTokenStore;
  publicBaseUrl: string;
  bindInfo: { sessionTtlMs: number };
  policy: OriginPolicy;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/devices` — pair a new device (D4/D5/§7.1). Gated by BOTH the
 * inherited session guard AND `requireTrustedLocal` (you pair FROM the local
 * browser). The server MINTS the deviceId (`crypto.randomUUID()`) — a
 * client-supplied id in the body is NEVER trusted (IDOR defense). The minted
 * token is returned ONCE here and is NEVER persisted to the registry (which
 * stores only `{deviceId,label,createdAt,exp}`) nor re-listed.
 */
export async function handleDevicePair(
  req: Request,
  deps: DevicePairDeps,
  guard: SessionGuard,
): Promise<Response> {
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof DevicePairRequestSchema.parse>;
  try {
    body = DevicePairRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const deviceId = randomUUID(); // SERVER-minted; the body's `deviceId` (if any) is ignored
  const createdAt = Date.now();
  const ttlMs = deps.bindInfo.sessionTtlMs;
  const exp = createdAt + ttlMs;
  const token = deps.sessionTokens.mintSessionToken({ deviceId, ttlMs });
  deps.deviceRegistry.append({ deviceId, label: body.label, createdAt, exp });
  recordDevicePair(deviceId, 'local');
  const pairingUrl = `${deps.publicBaseUrl}/#token=${token}`;
  return json(
    DevicePairResponseSchema.parse({ deviceId, token, pairingUrl }),
    202,
  );
}
```

- [ ] **Step 4: Wire the route** — in `src/server/app.ts`, import `handleDevicePair` (and `need`, T8). Add BELOW the `GET /api/devices` route (method-discriminated, same path). Build the handler's deps with `need`, which both narrows the OPTIONAL `ServerDeps` fields (`deviceRegistry`/`sessionTokens`/`publicBaseUrl`/`bindInfo`) to the NON-optional shapes `DevicePairDeps` requires — the fix for the `sessionTokens?` optionality mismatch — AND degrades to 503 when any is unwired:
```typescript
        if (req.method === 'POST' && url.pathname === '/api/devices') {
          const res = await handleDevicePair(req, {
            deviceRegistry: need(deps.deviceRegistry, 'deviceRegistry'),
            sessionTokens: need(deps.sessionTokens, 'sessionTokens'),
            publicBaseUrl: need(deps.publicBaseUrl, 'publicBaseUrl'),
            bindInfo: need(deps.bindInfo, 'bindInfo'),
            policy: deps.policy,
          }, guard);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 5: Run — verify green** → PASS (4 tests).

- [ ] **Step 6: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/devices/pair.ts src/server/app.ts tests/server/devices/pair.test.ts
git add src/server/devices/pair.ts src/server/app.ts tests/server/devices/pair.test.ts
git commit -m "feat(devices): POST /api/devices pair (server-minted id, token once) (Slice 25b Incr 3, §7.1)"
```

## Task 18: `POST /api/devices/:id/revoke` — revoke a device [FABLE ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY / FABLE (§7.1 — revoke closes the token AND prunes the list).** **Naive failure mode:** removing the registry row but forgetting the negative set, so the revoked device's still-valid HMAC token keeps verifying. **Mechanism:** revoke does BOTH — `sessionTokens.revokeDevice(id)` (adds to `revoked-devices.json`, so the stateless token stops verifying) AND `deviceRegistry.remove(id)` (drops the positive-list row). Gated by `requireTrustedLocal`. **Acceptance (folded into T21):** after revoke, the device's token no longer verifies AND it's gone from `GET /api/devices`; a non-local caller → `403`. Note the **action-sub-path-before-bare-`:id`** route ordering (like `/api/jobs/:id/cancel`).

**Files:**
- Create: `src/server/devices/revoke.ts`
- Modify: `src/server/app.ts` (route — BEFORE any future bare `/api/devices/:id`)
- Test: `tests/server/devices/revoke.test.ts` (new)

**Interfaces:**
- Consumes: `requireTrustedLocal` (T14), `SessionTokenStore.revokeDevice`, `DeviceRegistry.remove`, `recordDeviceRevoke` (T15).
- Produces: `handleDeviceRevoke(id, req, deps, guard): Response` → `200 {revoked:true}`; `403` from trusted-local. Route `POST /api/devices/:id/revoke`.

- [ ] **Step 1: Write the failing test** — `tests/server/devices/revoke.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';
import { handleDeviceRevoke } from '../../../src/server/devices/revoke.ts';

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'rev-'));
  const deviceRegistry = createDeviceRegistry({ path: join(dir, 'devices.json') });
  const sessionTokens = createSessionTokenStore({ path: join(dir, 'revoked.json'), rootToken: 'r' });
  const token = sessionTokens.mintSessionToken({ deviceId: 'd1', ttlMs: 100_000 });
  deviceRegistry.append({ deviceId: 'd1', label: 'phone', createdAt: 1, exp: Date.now() + 100_000 });
  return { deviceRegistry, sessionTokens, token, policy: { port: 4130, allowedOrigins: [], allowedHosts: [] } };
}
const localGuard: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'local' };
const req = new Request('http://127.0.0.1:4130/api/devices/d1/revoke', {
  method: 'POST', headers: { host: '127.0.0.1:4130' },
});

test('revoke prunes the registry AND stops the token verifying', () => {
  const c = ctx();
  expect(c.sessionTokens.verifySessionToken(c.token)?.deviceId).toBe('d1'); // valid before
  const res = handleDeviceRevoke('d1', req, c, localGuard);
  expect(res.status).toBe(200);
  expect(c.deviceRegistry.list().map((d) => d.deviceId)).toEqual([]); // pruned
  expect(c.sessionTokens.verifySessionToken(c.token)).toBeNull(); // token dead
});

test('a non-local caller is 403', () => {
  const remote: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'uuid' };
  expect(handleDeviceRevoke('d1', req, ctx(), remote).status).toBe(403);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/devices/revoke.ts`**:
```typescript
import type { SessionTokenStore } from '../security/session-token.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { recordDeviceRevoke } from './spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type DeviceRevokeDeps = {
  deviceRegistry: DeviceRegistry;
  sessionTokens: SessionTokenStore;
  policy: OriginPolicy;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/devices/:id/revoke` — revoke one device (D4/D5). Does BOTH: adds
 * to the negative set (`revokeDevice`, so the stateless HMAC token stops
 * verifying) AND prunes the positive registry row. Trusted-local gated — a
 * paired remote device cannot revoke.
 */
export function handleDeviceRevoke(
  id: string,
  req: Request,
  deps: DeviceRevokeDeps,
  guard: SessionGuard,
): Response {
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;
  deps.sessionTokens.revokeDevice(id);
  deps.deviceRegistry.remove(id);
  recordDeviceRevoke(id, 'local');
  return json({ revoked: true }, 200);
}
```

- [ ] **Step 4: Wire the route** — in `src/server/app.ts`, import `handleDeviceRevoke`. Add the action-sub-path match BEFORE any bare `/api/devices/:id` (there is none yet, but preserve the discipline), placed right after the `POST /api/devices` pair route:
```typescript
        const deviceRevoke = url.pathname.match(/^\/api\/devices\/([^/]+)\/revoke$/);
        if (req.method === 'POST' && deviceRevoke?.[1]) {
          const res = handleDeviceRevoke(deviceRevoke[1], req, {
            deviceRegistry: need(deps.deviceRegistry, 'deviceRegistry'),
            sessionTokens: need(deps.sessionTokens, 'sessionTokens'),
            policy: deps.policy,
          }, guard);
          rec.status(res.status);
          return res;
        }
```
(Import `need` from `app.ts` — the T8 helper — for the optional-dep narrowing/503 degrade.)

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/devices/revoke.ts src/server/app.ts tests/server/devices/revoke.test.ts
git add src/server/devices/revoke.ts src/server/app.ts tests/server/devices/revoke.test.ts
git commit -m "feat(devices): POST /api/devices/:id/revoke (Slice 25b Incr 3, §7.1)"
```

## Task 19: `POST /api/security/rotate-root` — break-glass rotate + local re-mint [FABLE ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY / FABLE (§7.1d,e — mass-invalidation must re-confirm the secret AND not self-DoS).** **Naive failure modes:** (d) rotate reachable without re-confirming the root secret — a CSRF-ish mass-invalidation write; `RotateRootRequestSchema.rootSecret` is constant-time-compared (via the existing `timingSafeEqual` idiom) against `rootTokens.getOrCreateRoot()`. (e) rotate logging out the operator's OWN tab (self-DoS) — rotate re-mints the local `'local'` session in the SAME response so the current tab survives. **Acceptance (folded into T21):** rotate invalidates every OTHER session while the re-minted local token still verifies; a wrong `rootSecret` → `401` with the registry/root untouched; also clears the device registry (the old paired devices' tokens are all dead now).

**Files:**
- Create: `src/server/security/rotate.ts` (`rotateRoot` orchestrator)
- Create: `src/server/security/rotate-route.ts` (`handleRotateRoot` route)
- Modify: `src/server/app.ts` (route)
- Test: `tests/server/security/rotate.test.ts` (new)

**Interfaces:**
- Consumes: `RotateRootRequestSchema` (T4), `RootTokenStore` (`root-token.ts`), `SessionTokenStore` (`session-token.ts`), `DeviceRegistry.clear` (T13), `requireTrustedLocal` (T14), `timingSafeEqual` (`node:crypto`), `recordRotateRoot` (T15).
- Produces: `rotateRoot(deps): { localToken: string }` (Shared contracts) — rotates the root (invalidating all sessions), re-mints the `'local'` session, clears the registry; `handleRotateRoot(req, deps, guard): Promise<Response>` → `200 { token: localToken }` (the tab swaps to the re-minted token), `401` on a wrong secret, `403` from trusted-local.

- [ ] **Step 1: Write the failing test** — `tests/server/security/rotate.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootTokenStore } from '../../../src/server/security/root-token.ts';
import { createSessionTokenStore } from '../../../src/server/security/session-token.ts';
import { createDeviceRegistry } from '../../../src/server/security/device-registry.ts';
import type { SessionGuard } from '../../../src/server/security/token.ts';
import { handleRotateRoot } from '../../../src/server/security/rotate-route.ts';

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'rot-'));
  const rootTokens = createRootTokenStore({ path: join(dir, 'daemon-token') });
  const rootSecret = rootTokens.getOrCreateRoot();
  // Build the session store over a root GETTER (not the captured string), so the
  // SAME live store re-signs/re-verifies with the NEW root after rotate() — this
  // is what makes rotate-root a real invalidation instead of a no-op, and what
  // lets the re-minted local token verify while the old device token dies.
  const sessionTokens = createSessionTokenStore({
    path: join(dir, 'revoked.json'),
    rootToken: () => rootTokens.getOrCreateRoot(),
  });
  const otherToken = sessionTokens.mintSessionToken({ deviceId: 'phone', ttlMs: 100_000 });
  const deviceRegistry = createDeviceRegistry({ path: join(dir, 'devices.json') });
  deviceRegistry.append({ deviceId: 'phone', label: 'p', createdAt: 1, exp: Date.now() + 100_000 });
  return { dir, rootTokens, rootSecret, sessionTokens, otherToken, deviceRegistry,
    bindInfo: { sessionTtlMs: 100_000 }, policy: { port: 4130, allowedOrigins: [], allowedHosts: [] } };
}
const localGuard: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'local' };
const req = (body: unknown) => new Request('http://127.0.0.1:4130/api/security/rotate-root', {
  method: 'POST', headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('rotate invalidates OTHER sessions while re-minting a working local token', async () => {
  const c = ctx();
  const res = await handleRotateRoot(req({ rootSecret: c.rootSecret }), c, localGuard);
  expect(res.status).toBe(200);
  const body = await res.json();
  // The OLD other-device token no longer verifies (root changed).
  const fresh = createSessionTokenStore({ path: join(c.dir, 'revoked.json'), rootToken: c.rootTokens.getOrCreateRoot() });
  expect(fresh.verifySessionToken(c.otherToken)).toBeNull();
  // The re-minted local token DOES verify against the NEW root.
  expect(fresh.verifySessionToken(body.token)?.deviceId).toBe('local');
  // Registry cleared (all old devices' tokens are dead).
  expect(c.deviceRegistry.list()).toEqual([]);
});

test('a wrong rootSecret is 401, root untouched', async () => {
  const c = ctx();
  const res = await handleRotateRoot(req({ rootSecret: 'WRONG' }), c, localGuard);
  expect(res.status).toBe(401);
  expect(c.rootTokens.getOrCreateRoot()).toBe(c.rootSecret); // not rotated
  expect(c.deviceRegistry.list()).toHaveLength(1); // untouched
});

test('a non-local caller is 403 (before any secret check)', async () => {
  const remote: SessionGuard = { verify: () => true, verifyToken: () => true, principal: () => 'uuid' };
  expect((await handleRotateRoot(req({ rootSecret: 'x' }), ctx(), remote)).status).toBe(403);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/security/rotate.ts`**:
```typescript
import type { RootTokenStore } from './root-token.ts';
import type { SessionTokenStore } from './session-token.ts';

/**
 * Break-glass root rotation (D5). Rolls the root (invalidating EVERY outstanding
 * session at once — their HMAC sigs no longer verify against the new key), then
 * re-mints the local browser's own `'local'` session so the operator's current
 * tab survives (anti-self-DoS, §7.1e). The caller (route) clears the device
 * registry and re-confirms the root secret BEFORE invoking this.
 */
export function rotateRoot(deps: {
  rootTokens: RootTokenStore;
  sessionTokens: SessionTokenStore;
  sessionTtlMs: number;
}): { localToken: string } {
  deps.rootTokens.rotate(); // new root — every existing session token is now invalid
  // The live session store was constructed over a root GETTER (T15:
  // `rootToken: () => rootTokens.getOrCreateRoot()`), so it re-reads the CURRENT
  // root on every sign/verify. After the rotate() above, this re-mint therefore
  // signs with the NEW root (verifies under it), while every previously-minted
  // token silently stops verifying — no store rebuild or guard swap needed.
  const localToken = deps.sessionTokens.mintSessionToken({ deviceId: 'local', ttlMs: deps.sessionTtlMs });
  return { localToken };
}
```
> **Implementation note for the executor (Fable to verify):** the getter that makes this real is wired in **T15** — `createSessionTokenStore`'s `rootToken` is `string | (() => string)`, resolved per-call in `sign`/`verify` — and `main.ts` constructs the live store as `rootToken: () => rootStore.getOrCreateRoot()` (T20), sharing the ONE `rootStore` instance that `deps.rootTokens` points at. So `rotateRoot` needs no store rebuild/guard-swap: `rootTokens.rotate()` overwrites the on-disk root, `getOrCreateRoot()` re-reads it, and the same live store (the one `createSessionGuard` verifies against) immediately signs/verifies under the new key. A captured string (the pre-fix bug) would leave the store signing with the STALE root — rotate-root would be a no-op and this task's `ctx()` fixture (which now passes the getter) would fail its post-rotate assertions.

- [ ] **Step 4: Implement `src/server/security/rotate-route.ts`**:
```typescript
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { RotateRootRequestSchema } from '../../contracts/index.ts';
import type { RootTokenStore } from './root-token.ts';
import type { SessionTokenStore } from './session-token.ts';
import type { DeviceRegistry } from './device-registry.ts';
import { requireTrustedLocal } from './trusted-local.ts';
import type { OriginPolicy } from './origin.ts';
import type { SessionGuard } from './token.ts';
import { rotateRoot } from './rotate.ts';
import { recordRotateRoot } from '../devices/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type RotateRootDeps = {
  rootTokens: RootTokenStore;
  sessionTokens: SessionTokenStore;
  deviceRegistry: DeviceRegistry;
  bindInfo: { sessionTtlMs: number };
  policy: OriginPolicy;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/** Constant-time secret compare (the token.ts / session-token.ts idiom): equal
 *  length then `timingSafeEqual`, never a content-dependent `===`. */
function secretMatches(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * `POST /api/security/rotate-root` — break-glass mass session-invalidation
 * (D5/§7.1d,e). Trusted-local gated, THEN re-confirms possession of the root
 * secret (constant-time). On success: rotate the root (all other sessions die),
 * clear the device registry, and return the re-minted local token so the
 * operator's own tab keeps working.
 */
export async function handleRotateRoot(
  req: Request,
  deps: RotateRootDeps,
  guard: SessionGuard,
): Promise<Response> {
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof RotateRootRequestSchema.parse>;
  try {
    body = RotateRootRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!secretMatches(deps.rootTokens.getOrCreateRoot(), body.rootSecret)) {
    return json({ error: 'unauthorized' }, 401); // wrong secret — root untouched
  }

  const { localToken } = rotateRoot({
    rootTokens: deps.rootTokens,
    sessionTokens: deps.sessionTokens,
    sessionTtlMs: deps.bindInfo.sessionTtlMs,
  });
  deps.deviceRegistry.clear(); // every paired device's token is dead now
  recordRotateRoot('local');
  return json({ token: localToken }, 200);
}
```

- [ ] **Step 5: Wire the route** — in `src/server/app.ts`, import `handleRotateRoot` (and `need`, T8). Narrow the OPTIONAL security deps via `need` (which also gives the 503 degrade when unset, and satisfies `RotateRootDeps`'s non-optional `rootTokens`/`sessionTokens`/`deviceRegistry`/`bindInfo`):
```typescript
        if (req.method === 'POST' && url.pathname === '/api/security/rotate-root') {
          const res = await handleRotateRoot(req, {
            rootTokens: need(deps.rootTokens, 'rootTokens'),
            sessionTokens: need(deps.sessionTokens, 'sessionTokens'),
            deviceRegistry: need(deps.deviceRegistry, 'deviceRegistry'),
            bindInfo: need(deps.bindInfo, 'bindInfo'),
            policy: deps.policy,
          }, guard);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 6: Run — verify green** → PASS (3 tests). Also run the existing `tests/server/security/session-token.test.ts` to confirm the getter change (if option (a)) kept them green.

- [ ] **Step 7: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/security/rotate.ts src/server/security/rotate-route.ts src/server/security/session-token.ts src/server/app.ts tests/server/security/rotate.test.ts
git add src/server/security/rotate.ts src/server/security/rotate-route.ts src/server/security/session-token.ts src/server/app.ts tests/server/security/rotate.test.ts
git commit -m "feat(security): POST /api/security/rotate-root break-glass + local re-mint (Slice 25b Incr 3, §7.1)"
```

## Task 20: `POST /api/jobs/:id/retry` — lineage-preserving re-enqueue (§11) + main.ts security wiring

**Files:**
- Create: `src/server/jobs/retry.ts`
- Modify: `src/server/app.ts` (route — action-sub-path BEFORE the bare `/api/jobs/:id` detail)
- Modify: `src/server/main.ts` (populate `deviceRegistry`, `rootTokens`, `publicBaseUrl`, `queueConcurrency` etc. finalised; add `AGENT_WEB_PUBLIC_URL` config row)
- Modify: `src/config/schema.ts` (`AGENT_WEB_PUBLIC_URL`)
- Test: `tests/server/jobs/retry.test.ts` (new)

**Interfaces:**
- Consumes: `JobStore.getJob`/`enqueue` (`src/queue/store.ts`), `JobStatus` (`src/queue/types.ts`), `newRunId`/`createRun` (`src/run/*`), `JobLaunchResponseSchema` (`src/contracts/requests.ts:304`), `ServerDeps`.
- Produces: `handleJobRetry(id, deps): Promise<Response>` → `202 {jobId, runId}` re-enqueueing a fresh job with the SAME `kind`+`payload`, stamping `retriedFrom: <originalId>` (T1). Only `Failed`/`Canceled`/`Interrupted` are retryable; unknown id or a non-retryable (`Done`/`Queued`/`Running`) → `404` (terminal-mismatch collapses to 404 per §11). Session-guarded (NOT trusted-local — a job mutation like cancel). Route `POST /api/jobs/:id/retry`.

- [ ] **Step 1: Write the failing test** — `tests/server/jobs/retry.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleJobRetry } from '../../../src/server/jobs/retry.ts';

function deps() {
  return {
    jobStore: createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {}),
    runsRoot: mkdtempSync(join(tmpdir(), 'runs-')),
  };
}

async function failedJob(d: ReturnType<typeof deps>) {
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: { input: 'go' }, maxAttempts: 1 });
  d.jobStore.claimNext();
  d.jobStore.markFailed(job.id, 'boom', false); // terminal Failed
  return job;
}

test('retry re-enqueues same kind+payload with retriedFrom lineage + fresh runId', async () => {
  const d = deps();
  const orig = await failedJob(d);
  const res = await handleJobRetry(orig.id, d);
  expect(res.status).toBe(202);
  const body = await res.json();
  const retry = d.jobStore.getJob(body.jobId);
  expect(retry?.kind).toBe(JobKind.Crew);
  expect(retry?.payload).toEqual({ input: 'go' });
  expect(retry?.retriedFrom).toBe(orig.id);
  expect(retry?.runId).toBe(body.runId);
  expect(body.runId).not.toBe(orig.runId); // fresh run dir
});

test('an unknown job id is 404', async () => {
  expect((await handleJobRetry('job-nope', deps())).status).toBe(404);
});

test('a Done/Queued job is not retryable → 404', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Chat, payload: 1 }); // Queued
  expect((await handleJobRetry(job.id, d)).status).toBe(404);
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `src/server/jobs/retry.ts`**:
```typescript
import { JobLaunchResponseSchema } from '../../contracts/index.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobStatus } from '../../queue/types.ts';
import { recordJobRetry } from '../../daemon/spans.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type JobRetryDeps = { jobStore: JobStore; runsRoot: string };

const RETRYABLE = new Set<JobStatus>([
  JobStatus.Failed,
  JobStatus.Canceled,
  JobStatus.Interrupted,
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...ISOLATION_HEADERS },
  });
}

/**
 * `POST /api/jobs/:id/retry` — lineage-preserving re-enqueue (§11). Loads the
 * job; only `Failed`/`Canceled`/`Interrupted` are retryable (a `Done`/`Queued`/
 * `Running` job, or an unknown id, → 404 — terminal-mismatch collapses to 404).
 * Re-enqueues a FRESH job with the same `kind`+`payload`, a fresh runId+run dir,
 * stamping `retriedFrom: <originalId>` so the drawer can back-link. Session-
 * guarded like the other job mutations.
 */
export async function handleJobRetry(id: string, deps: JobRetryDeps): Promise<Response> {
  const job = deps.jobStore.getJob(id);
  if (!job || !RETRYABLE.has(job.status)) return json({ error: 'not found' }, 404);
  const runId = newRunId();
  await createRun(deps.runsRoot, runId);
  const retry = deps.jobStore.enqueue({
    kind: job.kind,
    payload: job.payload,
    retriedFrom: job.id,
    runId,
  });
  recordJobRetry(retry);
  return json(JobLaunchResponseSchema.parse({ jobId: retry.id, runId }), 202);
}
```

- [ ] **Step 4: Wire the route** — in `src/server/app.ts`, import `handleJobRetry`. Add the retry action match ALONGSIDE the existing `cancelMatch`, BEFORE the bare `jobDetail` match:
```typescript
        const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
        if (req.method === 'POST' && retryMatch?.[1]) {
          const res = await handleJobRetry(retryMatch[1], deps);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 5: Finalise `main.ts` security wiring + config** — add the `AGENT_WEB_PUBLIC_URL` row to `src/config/schema.ts` (near the other `AGENT_WEB_*` rows):
```typescript
  {
    env: 'AGENT_WEB_PUBLIC_URL',
    kind: 'string',
    def: '',
    doc: 'Public base URL the device-pairing URL/QR (POST /api/devices) is built from — e.g. a Tailscale MagicDNS name or Cloudflare hostname. Empty = derive from the request Origin/Host at pair time. The pairing token rides the URL fragment (never a query — fragments do not reach the server/logs). Slice 25b D4.',
  },
```
In `src/server/main.ts`:
- **Hoist `createRootTokenStore(...)` out of the `else` branch** so the ONE `rootStore` instance is always in scope (it becomes both `deps.rootTokens` and the session store's root source — they MUST be the same instance for rotate-root to invalidate the live guard). There is a SINGLE `createSessionTokenStore` construction site (the `else` branch, `main.ts:227`); the daemon does not inject `sessionTokens`, so both standalone and daemon boot flow through it — wiring the getter here covers both. **Before:**
```typescript
  } else {
    const rootStore = createRootTokenStore({
      path: opts.rootTokenPath ?? defaultRootTokenPath(),
    });
    sessionTokens = createSessionTokenStore({
      path: opts.sessionRevocationPath ?? defaultRevocationPath(),
      rootToken: rootStore.getOrCreateRoot(),   // ← captured STRING (stale after rotate)
    });
```
**After** — hoist `rootStore` above the `if`, and pass a root GETTER so the live store re-reads the current root each sign/verify (T15's union type makes this compile):
```typescript
  const rootStore = createRootTokenStore({
    path: opts.rootTokenPath ?? defaultRootTokenPath(),
  });                                            // hoisted: always in scope
  // ... (opts.token / opts.sessionTokens branches unchanged) ...
  } else {
    sessionTokens = createSessionTokenStore({
      path: opts.sessionRevocationPath ?? defaultRevocationPath(),
      rootToken: () => rootStore.getOrCreateRoot(), // ← GETTER: honours rotate() on the live store
    });
```
- Build `deviceRegistry = createDeviceRegistry({ path: opts.deviceRegistryPath ?? defaultDeviceRegistryPath() })`; derive `publicBaseUrl = (cfg.AGENT_WEB_PUBLIC_URL as string) || \`http://${bind}:${port}\`` (the loopback fallback is fine for a same-box pair; a real tunnel sets the env). Add `deviceRegistry`, `rootTokens: rootStore`, and `publicBaseUrl` to the `deps` object (the same hoisted `rootStore` that now backs the session store's getter).
- The pair/revoke/rotate handlers do NOT take the whole `deps`: the app.ts route wiring (T17/T18/T19) assembles each handler's exact `Deps` shape via the `need(...)` helper (which narrows the optional `ServerDeps` fields and 503s when unwired), passing `deps.policy` and the `need`-narrowed `bindInfo`/`sessionTokens`/`deviceRegistry`/`rootTokens`/`publicBaseUrl`. Nothing here needs to change the handler `Deps` types.
- Add matching optional fields to `StartOptions` (`deviceRegistryPath?`, `publicBaseUrl?`, `rootTokens?`) for test injection.

- [ ] **Step 6: Run — verify green** — `bun test tests/server/jobs/retry.test.ts` → PASS; `bun run typecheck` clean.

- [ ] **Step 7: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/jobs/retry.ts src/server/app.ts src/server/main.ts src/config/schema.ts tests/server/jobs/retry.test.ts
git add src/server/jobs/retry.ts src/server/app.ts src/server/main.ts src/config/schema.ts tests/server/jobs/retry.test.ts
git commit -m "feat(jobs): POST /api/jobs/:id/retry lineage re-enqueue + security wiring (Slice 25b Incr 3, §11)"
```

## Task 20b: Loopback-only local-token injection (close the injected-`'local'`-token-over-tunnel bypass) [FABLE ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY / FABLE (§7.1b — the trusted-local gate must not be defeatable by simply loading `/`).** **Naive failure mode this task closes:** `deps.indexHtml` is rendered ONCE at boot with `window.__AGENT_TOKEN__ = <the 'local' session token>` and served to EVERY client — including a remote client over an allowed tunnel host. `client.ts sessionToken()` returns that injected token, so a remote client that merely loads `/` (or reads `window.__AGENT_TOKEN__`) can send `Bearer <local-token>`, making `guard.principal(req) === 'local'` — and pre-fix `requireTrustedLocal` passed on `hostAllowed` (which INCLUDES tunnel hosts), so a remote client could pair/revoke/rotate. **Mechanism (two independent backstops):** (1) T14 already tightened `requireTrustedLocal` to require `isLoopbackHost(req)` — an allowed tunnel host is no longer sufficient. (2) THIS task stops handing the `'local'` token to non-loopback clients at all: the index is rendered PER-REQUEST and injects `window.__AGENT_TOKEN__` ONLY when `isLoopbackHost(req)`. A remote index load gets the token-LESS base and must adopt a device-paired (non-`'local'`) token via the `#fragment` bootstrap (T36). **Acceptance (mandatory):** a loopback `/` carries `window.__AGENT_TOKEN__`; a request to `/` with an allowlisted-but-non-loopback tunnel Host does NOT — even though it passes the perimeter.

**Files:**
- Modify: `src/server/main.ts` (`renderIndexHtml` renders a token-LESS base; pass the local token via the new `localToken` dep, not baked into `indexHtml`)
- Modify: `src/server/app.ts` (`ServerDeps.localToken?`; `injectLocalToken` + `indexFor` helpers; `serveStatic` injects per-request only for `isLoopbackHost(req)`)
- Test: `tests/server/loopback-index.test.ts` (new)

**Interfaces:**
- Consumes: `isLoopbackHost` (`src/server/security/origin.ts`, T14), `renderIndexHtml` (`src/server/main.ts`), `ServerDeps.indexHtml`.
- Produces: `ServerDeps.localToken?: string` (the `'local'` session token, injected ONLY on loopback). `serveStatic` serves `indexFor(req, deps)` for `/`, `/index.html`, and the SPA fallback — the token-less base plus a per-request token script when `isLoopbackHost(req)` and `localToken` is set.

- [ ] **Step 1: Write the failing test** — `tests/server/loopback-index.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';

// A minimal ServerDeps: only the fields serveStatic/perimeter touch matter here.
function opsDeps(): ServerDeps {
  return {
    token: 'local-tok',
    localToken: 'local-tok',
    // Token-LESS base (what main.ts now renders): a <head> with a module script.
    indexHtml:
      '<!doctype html><html><head><title>t</title>' +
      '<script type="module" src="/assets/x.js"></script></head><body></body></html>',
    // Allow a non-loopback tunnel host past the perimeter so we can prove the
    // token is still withheld from it.
    policy: { port: 4130, allowedOrigins: [], allowedHosts: ['ts.example'] },
    recordIo: false,
  } as unknown as ServerDeps;
}

const get = (host: string) =>
  buildFetch(opsDeps())(new Request('http://x/', { headers: { host } }));

test('a loopback / request gets window.__AGENT_TOKEN__ injected', async () => {
  const body = await (await get('127.0.0.1:4130')).text();
  expect(body).toContain('window.__AGENT_TOKEN__="local-tok"');
});

test('a non-loopback (allowed tunnel) / request gets NO injected token', async () => {
  const res = await get('ts.example');
  expect(res.status).toBe(200);            // passes the perimeter (allowlisted)
  const body = await res.text();
  expect(body).not.toContain('window.__AGENT_TOKEN__'); // but never the local token
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL (`indexHtml` is served verbatim; no per-request injection yet).

- [ ] **Step 3: Render a token-LESS base in `src/server/main.ts`.** Make `renderIndexHtml`'s token param optional and omit the token line when it is `undefined` (the notify/voice globals are non-secret and stay in the base for everyone). **Before** (`main.ts:92`):
```typescript
export function renderIndexHtml(
  token: string,
  distIndexHtml?: string,
  ...
): string {
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const tokenScript =
    `<script>window.__AGENT_TOKEN__=${safeJson(token)};` +
    `window.__AGENT_NOTIFY_POLL_MS__=${safeJson(notify.pollMs)};` +
    // ... notify/voice globals ...
```
**After** — `token?: string`; the `__AGENT_TOKEN__` line is emitted only when a token is passed:
```typescript
export function renderIndexHtml(
  token: string | undefined,
  distIndexHtml?: string,
  ...
): string {
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const tokenLine =
    token === undefined ? '' : `window.__AGENT_TOKEN__=${safeJson(token)};`;
  const tokenScript =
    `<script>${tokenLine}` +
    `window.__AGENT_NOTIFY_POLL_MS__=${safeJson(notify.pollMs)};` +
    // ... notify/voice globals UNCHANGED ...
```
At the `deps` construction site, render the base token-LESS and pass the token separately:
```typescript
    indexHtml: renderIndexHtml(
      undefined,          // ← token-LESS base; the local token is injected per-request in serveStatic
      distIndexHtml,
      { pollMs: cfg.AGENT_WEB_NOTIFY_POLL_MS as number, minDurationMs: cfg.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number },
      { defaultModel: cfg.AGENT_WEB_VOICE_DEFAULT_MODEL as string, vadSilenceMs: cfg.AGENT_WEB_VOICE_VAD_SILENCE_MS as number },
    ),
    localToken: token,    // ← injected as window.__AGENT_TOKEN__ ONLY for loopback requests (serveStatic)
```
(`token` is the `'local'` session token — or the legacy `opts.token` constant — already computed above. Loopback dev/tests still receive it; only remote clients are withheld.)

- [ ] **Step 4: Per-request injection in `src/server/app.ts`.** Add the optional dep + the two helpers, and route index serving through `indexFor`.
  - In `ServerDeps`, add (optional, so fixtures that bake the token into `indexHtml` and set no `localToken` keep working unchanged):
```typescript
  /** The local-browser session token (deviceId 'local'). Injected into the
   *  served index as window.__AGENT_TOKEN__ ONLY for a loopback request (see
   *  serveStatic/indexFor). A remote client over an allowed tunnel host gets the
   *  token-LESS base and must adopt a device-paired token via the #fragment
   *  bootstrap — so a remote index load can never obtain the trusted-'local'
   *  token and defeat requireTrustedLocal (Slice 25b §7.1b). Absent = never
   *  inject (legacy fixtures whose indexHtml already carries a token). */
  localToken?: string;
```
  - Add the helpers near `serveStatic` (import `isLoopbackHost` from `./security/origin.ts` — the existing origin import already brings in `enforcePerimeter`/`OriginPolicy`):
```typescript
// Matches the built SPA's ES-module entry tag (mirrors main.ts's MODULE_SCRIPT_TAG).
const MODULE_SCRIPT_TAG = /<script\s+type="module"[^>]*>/i;

/** Inject `window.__AGENT_TOKEN__` into a token-LESS base index, before the SPA
 *  module script so it is defined before app code runs. `JSON.stringify` does
 *  not escape `</`, so escape `<` to keep the value from breaking out of the
 *  <script> (same guard as renderIndexHtml). */
function injectLocalToken(baseHtml: string, token: string): string {
  const safe = JSON.stringify(token).replace(/</g, '\\u003c');
  const script = `<script>window.__AGENT_TOKEN__=${safe};</script>`;
  if (MODULE_SCRIPT_TAG.test(baseHtml)) {
    return baseHtml.replace(MODULE_SCRIPT_TAG, (m) => script + m);
  }
  return baseHtml.replace(/<head(\s[^>]*)?>/i, (m) => m + script);
}

/** The index HTML to serve THIS request. The local session token is injected
 *  ONLY for a loopback Host (isLoopbackHost) — a remote client over an allowed
 *  tunnel gets the token-less base and must pair a device (the #fragment
 *  bootstrap) to authenticate, so it can never hold the trusted 'local' token
 *  and defeat requireTrustedLocal. */
function indexFor(req: Request, deps: ServerDeps): string {
  if (deps.localToken !== undefined && isLoopbackHost(req)) {
    return injectLocalToken(deps.indexHtml, deps.localToken);
  }
  return deps.indexHtml;
}
```
  - In `serveStatic`, replace BOTH `deps.indexHtml` serve sites with `indexFor(req, deps)`:
```typescript
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(indexFor(req, deps), { headers: INDEX_HTML_HEADERS });
  }
  // ... later, the SPA fallback ...
    return new Response(indexFor(req, deps), { headers: INDEX_HTML_HEADERS });
```

- [ ] **Step 5: Run — verify green** — `bun test tests/server/loopback-index.test.ts` → PASS. Also re-run the existing `tests/server/main*.test.ts` / static-serving tests: those fetch `/` over loopback and still expect `window.__AGENT_TOKEN__` — the loopback branch preserves that.

- [ ] **Step 6: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/server/main.ts src/server/app.ts tests/server/loopback-index.test.ts
git add src/server/main.ts src/server/app.ts tests/server/loopback-index.test.ts
git commit -m "fix(security): loopback-only local-token injection — no 'local' token to remote index loads (Slice 25b Incr 3, §7.1b)"
```

## Task 21: Security acceptance suite (§7.1 — IDOR · trusted-local · no-token-leak · rotate self-survival) [FABLE ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY / FABLE — this is the §7.1 acceptance gate, the Fable-reviewed core.** It exercises the pair/revoke/rotate routes END-TO-END through a booted `startWebServer` (real guard, real registry, real session store), asserting the full threat model. Do NOT soften any assertion; a red assertion here blocks the increment.

**Files:**
- Create: `tests/server/security/ops-acceptance.integration.test.ts`

**Interfaces:**
- Consumes: `startWebServer` (`src/server/main.ts`) booted with temp `~/.agent`-style paths + a known root, the injected `sessionTokens`/`deviceRegistry`/`rootTokens`, and raw `fetch` against the served instance.
- Produces: the §7.1 acceptance set green: (1) pair mints a server-side id + returns the token once; (2) a request from a non-`'local'` principal (a paired remote device's own token) gets `403` on all three routes; (3) revoke prunes the registry AND adds to the negative set so the token stops verifying; (4) rotate invalidates all OTHER sessions while the local caller's re-minted token still verifies; (5) rotate with a wrong `rootSecret` → `401`, registry untouched; (6) the minted token never appears in `GET /api/devices`; **(7) a REMOTE-tunnel request that carries the injected `'local'` token — i.e. the SAME `localToken`, but over an allowlisted non-loopback Host — gets `403` on pair/revoke/rotate (distinct from case (2): here the principal IS `'local'`, and only the loopback-Host requirement stops it).**

- [ ] **Step 1: Write the acceptance test** — boot `startWebServer` on an ephemeral port with injected temp-path stores (mirror the existing `tests/server/main*.integration.test.ts` boot fixture). Drive real `fetch`:
```typescript
import { test, expect } from 'bun:test';
// boot helper: startWebServer({ ...tempPaths, sessionTokens, deviceRegistry, rootTokens })
// returns { port, localToken }. (Reuse/extend the existing main integration fixture.)

test('§7.1 acceptance: pair→list→revoke→rotate threat model end-to-end', async () => {
  const srv = await bootOpsServer(); // helper in this file
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, host: `127.0.0.1:${srv.port}` });

  // (1) pair from the trusted-local browser mints a server-side id + token once.
  const pairRes = await fetch(`http://127.0.0.1:${srv.port}/api/devices`, {
    method: 'POST', headers: { ...auth(srv.localToken), 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'phone', deviceId: 'local' /* IDOR attempt, must be ignored */ }),
  });
  expect(pairRes.status).toBe(202);
  const paired = await pairRes.json();
  expect(paired.deviceId).not.toBe('local');

  // (6) the token never appears in GET /api/devices.
  const listRes = await fetch(`http://127.0.0.1:${srv.port}/api/devices`, { headers: auth(srv.localToken) });
  const list = await listRes.json();
  expect(JSON.stringify(list)).not.toContain(paired.token);

  // (2) the paired REMOTE device (its own token) cannot pair/revoke/rotate → 403.
  const remotePair = await fetch(`http://127.0.0.1:${srv.port}/api/devices`, {
    method: 'POST', headers: { ...auth(paired.token), 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'evil' }),
  });
  expect(remotePair.status).toBe(403);

  // (7) the injected 'local' token replayed over an allowlisted TUNNEL Host
  //     (principal IS 'local', but NOT loopback) cannot pair/revoke/rotate → 403.
  //     bootOpsServer allowlists 'ts.example' so this passes the perimeter and
  //     reaches requireTrustedLocal, which rejects it on the loopback-Host check.
  const tunnel = (t: string) => ({ authorization: `Bearer ${t}`, host: 'ts.example' });
  const tunnelPair = await fetch(`http://127.0.0.1:${srv.port}/api/devices`, {
    method: 'POST', headers: { ...tunnel(srv.localToken), 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'evil-tunnel' }),
  });
  expect(tunnelPair.status).toBe(403);
  const tunnelRotate = await fetch(`http://127.0.0.1:${srv.port}/api/security/rotate-root`, {
    method: 'POST', headers: { ...tunnel(srv.localToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rootSecret: srv.rootSecret }),
  });
  expect(tunnelRotate.status).toBe(403); // rejected BEFORE the secret check

  // (3) revoke prunes the registry AND kills the token.
  await fetch(`http://127.0.0.1:${srv.port}/api/devices/${paired.deviceId}/revoke`, {
    method: 'POST', headers: auth(srv.localToken),
  });
  const afterRevoke = await fetch(`http://127.0.0.1:${srv.port}/api/jobs`, { headers: auth(paired.token) });
  expect(afterRevoke.status).toBe(401); // token no longer verifies

  // (5) rotate with a WRONG secret → 401, nothing changes.
  const badRotate = await fetch(`http://127.0.0.1:${srv.port}/api/security/rotate-root`, {
    method: 'POST', headers: { ...auth(srv.localToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rootSecret: 'WRONG' }),
  });
  expect(badRotate.status).toBe(401);

  // (4) rotate with the RIGHT secret → 200; the returned token keeps working,
  //     the pre-rotate local token dies.
  const goodRotate = await fetch(`http://127.0.0.1:${srv.port}/api/security/rotate-root`, {
    method: 'POST', headers: { ...auth(srv.localToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rootSecret: srv.rootSecret }),
  });
  expect(goodRotate.status).toBe(200);
  const rotated = await goodRotate.json();
  const withNew = await fetch(`http://127.0.0.1:${srv.port}/api/jobs`, { headers: auth(rotated.token) });
  expect(withNew.status).toBe(200); // re-minted local token survives
  const withOld = await fetch(`http://127.0.0.1:${srv.port}/api/jobs`, { headers: auth(srv.localToken) });
  expect(withOld.status).toBe(401); // pre-rotate token invalidated

  srv.stop();
});
```
Implement the `bootOpsServer` helper in the same file, extending the existing main integration boot fixture to expose `{ port, localToken, rootSecret, stop }` and to inject the temp `deviceRegistry`/`rootTokens`/`sessionTokens`. Two fixture requirements make cases (4)/(7) real:
- **Build the injected `sessionTokens` over a root GETTER** — `createSessionTokenStore({ path: <temp>, rootToken: () => rootTokens.getOrCreateRoot() })` sharing the injected `rootTokens` (whose `getOrCreateRoot()` yields the known `rootSecret`). This is what lets the good-rotate case re-mint a local token that verifies under the NEW root while the pre-rotate token dies; a captured string here would make case (4) unfalsifiable (rotate would be a no-op).
- **Allowlist a tunnel host** — pass `allowedHosts: ['ts.example']` (and/or `AGENT_WEB_ALLOWED_HOSTS`) so case (7)'s `Host: ts.example` request clears the perimeter and actually reaches `requireTrustedLocal` (otherwise it would 403 at the perimeter for the wrong reason).

- [ ] **Step 2: Run — verify green** — `bun test tests/server/security/ops-acceptance.integration.test.ts` → PASS. If any assertion fails, fix the OWNING route (T17–T19), never the test.

- [ ] **Step 3: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- tests/server/security/ops-acceptance.integration.test.ts
git add tests/server/security/ops-acceptance.integration.test.ts
git commit -m "test(security): §7.1 pairing/revoke/rotate acceptance gate (Slice 25b Incr 3)"
```

## Task 22: Boundary gate — Increment 3

**Files:** none (verification only).

- [ ] **Step 1: Full gate** — `bun run check` → PASS. The device registry + trusted-local gate + pair/revoke/rotate-root + lineage retry are all live and the §7.1 acceptance suite (incl. the tunnel-replay case (7)) is green. This increment is the Fable review target — request a whole-increment adversarial security review (ultracode/Fable) of `src/server/devices/`, `src/server/security/{device-registry,trusted-local,rotate,rotate-route}.ts`, the `session-token.ts` root getter (rotate correctness) + `origin.ts` `isLoopbackHost`, the `app.ts` route ordering + `need(...)` degrade + `serveStatic`/`indexFor` loopback-only token injection, and `main.ts`'s token-less base + hoisted single `rootStore` BEFORE moving on; address findings, re-review, never soften. Re-check budget.

---

# Increment 4 — Web Ops shell (nav · /ops route · roving-tabindex sub-nav · ⌘K)

**Purpose (spec §5.4, §6):** the four-tab console shell mirroring the existing feature-module conventions EXACTLY — `web/src/features/ops/index.tsx` (`OpsArea`), `data-testid="area-ops"`, roving-tabindex tab-list via `nextTabIndex`, each panel its own `RegionErrorBoundary`, the active tab a deep-linkable `?tab=` search param. Sonnet floor (mechanical web). Web tasks gate with `cd web && bun run typecheck && bun run test`.

## Task 23: Nav entry + `/ops` route (tab search param) + `OpsArea` shell with four stub panels

**Files:**
- Modify: `web/src/app/app-shell.tsx` (add `{ to: '/ops', label: 'Ops' }` to `NAV`)
- Modify: `web/src/app/router.tsx` (register `/ops` with a `validateSearch` for `?tab=`)
- Create: `web/src/features/ops/index.tsx` (`OpsArea` shell + four placeholder panels)
- Test: `web/src/features/ops/index.test.tsx` (new)

**Interfaces:**
- Consumes: `nextTabIndex` (`web/src/shared/ui/tab-list.ts`), `RegionErrorBoundary` (`web/src/shared/ui/error-boundary.tsx`), TanStack `useSearch`/`useNavigate`, the `route`/`createRoute` helpers (`web/src/app/router.tsx`).
- Produces: `OpsArea` at `/ops` with `data-testid="area-ops"`; `OpsTab` enum (`Overview='overview'|Jobs='jobs'|Triggers='triggers'|Devices='devices'`); the active tab read from `?tab=` (default `overview`), each tab switch pushing `?tab=` via `navigate` so it's deep-linkable; four panels each wrapped in its own `RegionErrorBoundary`. Panels are placeholders here (`<div data-testid="ops-panel-jobs" />` etc.), replaced tab-by-tab in Increments 5–8.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/index.test.tsx`:
```typescript
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('OpsArea', () => {
  it('renders the Ops shell with four tabs, defaulting to Overview', async () => {
    renderAt('/ops');
    expect(await screen.findByTestId('area-ops')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Triggers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Devices & Access' })).toBeInTheDocument();
  });

  it('deep-links to a tab via ?tab=', async () => {
    renderAt('/ops?tab=jobs');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByTestId('ops-panel-jobs')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify it fails** — `cd web && bun run test src/features/ops/index.test.tsx` → FAIL (no `/ops` route).

- [ ] **Step 3: Register the route** — in `web/src/app/router.tsx`: import `OpsArea`. Add the tab search-param type + route (mirroring `runDetailRoute`'s `validateSearch`):
```typescript
export type OpsSearch = { tab?: 'overview' | 'jobs' | 'triggers' | 'devices' };

const opsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops',
  component: OpsArea,
  validateSearch: (search: Record<string, unknown>): OpsSearch => ({
    tab:
      search.tab === 'jobs' || search.tab === 'triggers' || search.tab === 'devices'
        ? search.tab
        : 'overview',
  }),
});
```
Add `opsRoute` to `rootRoute.addChildren([...])` (after `route('/library', LibraryArea)`). Add `import { OpsArea } from '../features/ops/index.tsx';`.

- [ ] **Step 4: Add the nav entry** — in `web/src/app/app-shell.tsx`, add to `NAV` (after `{ to: '/runs', label: 'Runs' }`):
```typescript
  { to: '/ops', label: 'Ops' },
```

- [ ] **Step 5: Implement `web/src/features/ops/index.tsx`**:
```typescript
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useRef } from 'react';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** The four Ops tabs. `enum` per this repo's enum-over-union convention. */
export enum OpsTab {
  Overview = 'overview',
  Jobs = 'jobs',
  Triggers = 'triggers',
  Devices = 'devices',
}

const TABS: { id: OpsTab; label: string }[] = [
  { id: OpsTab.Overview, label: 'Overview' },
  { id: OpsTab.Jobs, label: 'Jobs' },
  { id: OpsTab.Triggers, label: 'Triggers' },
  { id: OpsTab.Devices, label: 'Devices & Access' },
];

const routeApi = getRouteApi('/ops');

/** The Ops console shell (spec §5.4/§6): one section, four roving-tabindex tabs.
 *  The active tab is the `?tab=` search param so it is deep-linkable and ⌘K can
 *  target it. Each panel is its own `RegionErrorBoundary` region so one failing
 *  card never blanks the whole console. Panels start as stubs and are replaced
 *  tab-by-tab (Increments 5–8). */
export function OpsArea() {
  const { tab } = routeApi.useSearch();
  const navigate = useNavigate();
  const active = (tab ?? OpsTab.Overview) as OpsTab;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(next: OpsTab) {
    void navigate({ to: '/ops', search: { tab: next } });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) select(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-ops" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Ops</h1>
      <div
        role="tablist"
        aria-label="Ops sections"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`ops-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`ops-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            data-testid={`ops-tab-${t.id}`}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${
              active === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {TABS.map(
          (t) =>
            active === t.id && (
              <div
                key={t.id}
                role="tabpanel"
                id={`ops-panel-${t.id}`}
                aria-labelledby={`ops-tab-${t.id}`}
                data-testid={`ops-panel-${t.id}`}
              >
                <RegionErrorBoundary region={`Ops: ${t.label}`}>
                  {/* Increments 5–8 replace these stubs with the real tabs. */}
                  <p className="text-sm text-[var(--color-muted)]">{t.label} — coming in a later increment.</p>
                </RegionErrorBoundary>
              </div>
            ),
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run — verify green** — `cd web && bun run test src/features/ops/index.test.tsx` → PASS.

- [ ] **Step 7: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/index.test.tsx
cd .. && git add web/src/features/ops/index.tsx web/src/app/router.tsx web/src/app/app-shell.tsx web/src/features/ops/index.test.tsx
git commit -m "feat(web): Ops console shell + /ops route + tab search param (Slice 25b Incr 4)"
```

## Task 24: ⌘K commands — `go-ops` + per-tab nav

**Files:**
- Modify: `web/src/app/commands.ts` (append `Nav` commands)
- Test: `web/src/app/command-palette.test.tsx` (extend) or `web/src/features/ops/commands.test.tsx` (new)

**Interfaces:**
- Consumes: the `commands` array + `CommandKind` (`web/src/app/commands.ts:46`).
- Produces: a `go-ops` command (navigates `/ops`) + optionally one per tab (`go-ops-jobs` → `/ops?tab=jobs`, etc.), using the `NavCommand` shape `run: (n) => n({ to: '/ops', search: { tab: 'jobs' } })`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/commands.test.tsx`:
```typescript
import { describe, expect, it } from 'vitest';
import { commands } from '../../app/commands.ts';

describe('Ops ⌘K commands', () => {
  it('includes a Go to Ops command and per-tab commands', () => {
    const ids = commands.map((c) => c.id);
    expect(ids).toContain('go-ops');
    expect(ids).toContain('go-ops-jobs');
    expect(ids).toContain('go-ops-devices');
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement** — append to the `commands` array in `web/src/app/commands.ts` (before the `Action`-kind entries):
```typescript
  {
    id: 'go-ops',
    label: 'Go to Ops',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/ops' }),
  },
  {
    id: 'go-ops-jobs',
    label: 'Go to Ops · Jobs',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/ops', search: { tab: 'jobs' } }),
  },
  {
    id: 'go-ops-devices',
    label: 'Go to Ops · Devices & Access',
    kind: CommandKind.Nav,
    run: (n) => n({ to: '/ops', search: { tab: 'devices' } }),
  },
```

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/commands.test.tsx
cd .. && git add web/src/app/commands.ts web/src/features/ops/commands.test.tsx
git commit -m "feat(web): ⌘K Ops nav commands (Slice 25b Incr 4)"
```

## Task 25: Ops shell roving-tabindex keyboard nav + a11y-baseline

**Files:**
- Modify: `web/src/app/tab-widget-keyboard.test.tsx` (extend to cover `area-ops`) OR create `web/src/features/ops/keyboard.test.tsx`
- Modify: `web/src/app/a11y-baseline.test.tsx` (add `/ops` to the swept routes)

**Interfaces:**
- Consumes: `renderAt` (`web/src/test/render.tsx`), `axe` (vitest-axe), `fireEvent`.
- Produces: a passing keyboard-nav test (ArrowRight/ArrowLeft/Home/End roving over the four tabs, `tabIndex` roving, focus moves) + an axe-clean `/ops` in the a11y sweep.

- [ ] **Step 1: Write the failing keyboard test** — `web/src/features/ops/keyboard.test.tsx`:
```typescript
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('Ops tab keyboard navigation', () => {
  it('ArrowRight moves the active tab and focus (roving tabindex)', async () => {
    renderAt('/ops');
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const jobs = screen.getByRole('tab', { name: 'Jobs' });
    expect(jobs).toHaveAttribute('aria-selected', 'true');
    expect(jobs).toHaveAttribute('tabindex', '0');
    expect(overview).toHaveAttribute('tabindex', '-1');
  });

  it('End jumps to the last tab, Home to the first', async () => {
    renderAt('/ops');
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    fireEvent.keyDown(overview, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Devices & Access' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Devices & Access' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run — verify it passes** — the shell (T23) already implements roving via `nextTabIndex`, so this should PASS immediately; if `aria-selected` doesn't move because the search-param nav is async, add a `waitFor`. This task LOCKS the keyboard contract (regression guard), so keep the assertions strict.

- [ ] **Step 3: Add `/ops` to the a11y sweep** — in `web/src/app/a11y-baseline.test.tsx`, add `'/ops'` to the routes array it renders + axes. Run → PASS (axe-clean).

- [ ] **Step 4: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/keyboard.test.tsx src/app/a11y-baseline.test.tsx
cd .. && git add web/src/features/ops/keyboard.test.tsx web/src/app/a11y-baseline.test.tsx
git commit -m "test(web): Ops roving-tabindex keyboard nav + a11y baseline (Slice 25b Incr 4)"
```

## Task 26: Boundary gate — Increment 4

**Files:** none (verification only).

- [ ] **Step 1: Web gate** — `cd web && bun run typecheck && bun run test` → PASS (all web tests). Then the root `bun run check` → PASS (docs-check may warn that `web/src/features/ops/` is a new module — that's a web dir, not a `src/<subsystem>`, so `docs:check` doesn't gate it; architecture.md's web-module-map is updated in Increment 9). Re-check budget.

---

# Increment 5 — Jobs tab (queue table + detail drawer + cancel/resume/retry + deep-link)

**Purpose (spec §5.5, D2):** the real queue table with facet filters + keyset "load more" (mirroring `web/src/features/runs/index.tsx`), a row → detail drawer, and the three lifecycle actions with optimistic UI. Sonnet floor except the resume/checkpoint deep-link (T30, flagged). Web gates.

## Task 27: `use-jobs.ts` — job list hook (facets + cursor pagination)

**Files:**
- Create: `web/src/features/ops/use-jobs.ts`
- Test: `web/src/features/ops/use-jobs.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch` (`web/src/shared/contract/client.ts`), `JobListResponseSchema` + `JobListResponse` + `JobStatusWire`/`JobKindWire`/`JobPriorityWire` (`@contracts`).
- Produces: `useJobs(): { page, error, query, setQuery, goNext, goFirst, refresh }` — mirrors `RunsArea`'s `cursors[]`/`page`/`nextCursor` pattern against `GET /api/jobs?status=&cursor=&limit=`. `JobsQuery = { status: string; kind: string; priority: string }` (status → server `?status=`; kind/priority filter client-side on the returned page, since `GET /api/jobs` only server-filters by `status` — see `JobListQuerySchema`). `refresh()` re-fetches the current page (used by optimistic actions to reconcile).

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/use-jobs.test.tsx` (render a tiny probe component that calls the hook, mock `fetch`):
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJobs } from './use-jobs.ts';

function Probe() {
  const { page } = useJobs();
  return <div data-testid="count">{page ? page.items.length : 'loading'}</div>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('useJobs', () => {
  it('fetches the first page of jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      items: [{ id: 'job-1', kind: 'crew', payload: {}, priority: 'normal', status: 'queued',
        attempts: 0, maxAttempts: 3, createdAt: 1, updatedAt: 1, availableAt: 0, retriedFrom: null }],
      total: 1,
    })));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `web/src/features/ops/use-jobs.ts`** (mirroring `RunsArea`'s effect exactly):
```typescript
import type { JobListResponse } from '@contracts';
import { JobListResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

export type JobsQuery = { status: string; kind: string; priority: string };
const emptyQuery: JobsQuery = { status: '', kind: '', priority: '' };

function toJobsPath(query: JobsQuery, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status); // server-side facet
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

export function useJobs() {
  const [query, setQuery] = useState<JobsQuery>(emptyQuery);
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<JobListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);
  const cursor = cursors.at(-1);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toJobsPath(query, cursor), { schema: JobListResponseSchema })
      .then((result) => {
        if (cancelled) return;
        // kind/priority are client-side facets (server filters status only).
        const items = result.items.filter(
          (j) => (!query.kind || j.kind === query.kind) && (!query.priority || j.priority === query.priority),
        );
        setPage({ ...result, items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load jobs');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, cursor, reloadTick]);

  return {
    page,
    error,
    query,
    setQuery: (patch: Partial<JobsQuery>) => {
      setCursors([]);
      setQuery((prev) => ({ ...prev, ...patch }));
    },
    goNext: () => {
      const next = page?.nextCursor;
      if (next) setCursors((prev) => [...prev, next]);
    },
    goFirst: () => setCursors([]),
    refresh: () => setReloadTick((t) => t + 1),
  };
}
```

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/use-jobs.test.tsx
cd .. && git add web/src/features/ops/use-jobs.ts web/src/features/ops/use-jobs.test.tsx
git commit -m "feat(web): useJobs list hook (facets + cursor) (Slice 25b Incr 5)"
```

## Task 28: `jobs-tab.tsx` — queue table + facet filters + load-more

**Files:**
- Create: `web/src/features/ops/jobs-tab.tsx`
- Modify: `web/src/features/ops/index.tsx` (render `<JobsTab />` in the Jobs panel)
- Test: `web/src/features/ops/jobs-tab.test.tsx` (new)

**Interfaces:**
- Consumes: `useJobs` (T27), `Button` (`web/src/shared/ui/button.tsx`), `JobStatusWire`/`JobKindWire`/`JobPriorityWire` (`@contracts`).
- Produces: `JobsTab` — a table of the current page (id, kind, status, priority, attempts/maxAttempts, createdAt), status/kind/priority `<select>` facets wired to `setQuery`, First/Next paging buttons, an empty-state, an error region. Each row is clickable (opens the drawer — wired in T29). `data-testid="ops-jobs-table"`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/jobs-tab.test.tsx`:
```typescript
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const job = { id: 'job-42', kind: 'crew', payload: {}, priority: 'normal', status: 'running',
  attempts: 1, maxAttempts: 3, createdAt: 1, updatedAt: 1, availableAt: 0, retriedFrom: null };

describe('JobsTab', () => {
  it('lists jobs from GET /api/jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [job], total: 1 })));
    renderAt('/ops?tab=jobs');
    await waitFor(() => expect(screen.getByText('job-42')).toBeInTheDocument());
    expect(screen.getByTestId('ops-jobs-table')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows an empty-state when there are no jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [], total: 0 })));
    renderAt('/ops?tab=jobs');
    await waitFor(() => expect(screen.getByText('No jobs yet')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `web/src/features/ops/jobs-tab.tsx`** — a table + facet selects + paging, structured like `RunsArea` but tabular. Use `JobStatusWire`/`JobKindWire`/`JobPriorityWire` for the facet options (`['', ...Object.values(Enum)]` with an "All" escape hatch). Render `page.items` as `<tr>` rows with `data-testid={`ops-job-row-${job.id}`}` and an `onClick` prop `onSelect(job.id)` (the drawer wiring in T29 passes it). Include First/Next `<Button>`s gated on `cursors.length`/`page.nextCursor`, an empty-state `<p>No jobs yet</p>`, and an `role="alert"` error block — copy the exact class-name idiom from `RunsArea`.

- [ ] **Step 4: Wire into the shell** — in `web/src/features/ops/index.tsx`, replace the Jobs panel stub with `<JobsTab />` (import it). Keep the other panels stubbed.

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/jobs-tab.test.tsx src/features/ops/index.test.tsx
cd .. && git add web/src/features/ops/jobs-tab.tsx web/src/features/ops/index.tsx web/src/features/ops/jobs-tab.test.tsx
git commit -m "feat(web): Jobs tab queue table + facets + paging (Slice 25b Incr 5)"
```

## Task 29: `job-detail-drawer.tsx` — detail panel + Runs deep-link + retriedFrom back-link

**Files:**
- Create: `web/src/features/ops/job-detail-drawer.tsx`
- Modify: `web/src/features/ops/jobs-tab.tsx` (open the drawer on row click)
- Test: `web/src/features/ops/job-detail-drawer.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch` (`GET /api/jobs/:id`), `JobDtoSchema`/`JobDTO` (`@contracts`), TanStack `Link` (deep-link into `/runs/$runId`), `Button`.
- Produces: `JobDetailDrawer({ jobId, onClose })` — fetches `GET /api/jobs/:id`, renders `payload` (JSON), `attempts`/`maxAttempts`, all timestamps (`createdAt`/`updatedAt`/`startedAt`/`finishedAt`), retry-scheduled-at (`availableAt`), `error`, `status`/`priority`, and — when `runId` is set — a `<Link to="/runs/$runId" params={{ runId }}>` deep-link into the existing Runs viewer + its SSE stream. When `retriedFrom` is non-null, shows "retry of job X" with a back-link that re-opens the drawer on that id. `data-testid="ops-job-drawer"`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/job-detail-drawer.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const detail = { id: 'job-7', kind: 'crew', payload: { input: 'go' }, priority: 'normal',
  status: 'failed', attempts: 3, maxAttempts: 3, createdAt: 1, updatedAt: 2, finishedAt: 2,
  availableAt: 0, runId: 'run-xyz', error: 'boom', retriedFrom: 'job-1' };

describe('JobDetailDrawer', () => {
  it('opens on row click, shows detail + a Runs deep-link + retriedFrom back-link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/api/jobs/job-7')
        ? jsonResponse(detail)
        : jsonResponse({ items: [{ ...detail, retriedFrom: 'job-1' }], total: 1 }),
    ));
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    expect(await screen.findByTestId('ops-job-drawer')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /run-xyz/ })).toHaveAttribute('href', '/runs/run-xyz');
    expect(screen.getByText(/retry of job-1/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `web/src/features/ops/job-detail-drawer.tsx`** — a fixed side panel (reuse the `Dialog` primitive or a simple `<aside>` with `data-testid="ops-job-drawer"`), fetching the detail via `apiFetch(`/jobs/${jobId}`, { schema: JobDtoSchema })`, rendering the fields above. For the run deep-link:
```tsx
{detail.runId && (
  <Link to="/runs/$runId" params={{ runId: detail.runId }} className="...hover:border-accent...">
    view run {detail.runId}
  </Link>
)}
{detail.retriedFrom && (
  <button type="button" onClick={() => onSelect(detail.retriedFrom!)} className="...">
    retry of {detail.retriedFrom}
  </button>
)}
```
Render `payload` as `JSON.stringify(detail.payload, null, 2)` in a `<pre>` with `overflow-x-auto`. Wire the action buttons placeholder region (cancel/resume/retry land in T30).

- [ ] **Step 4: Wire row click** — in `jobs-tab.tsx`, add `const [openJobId, setOpenJobId] = useState<string | undefined>()`; row `onClick={() => setOpenJobId(job.id)}`; render `{openJobId && <JobDetailDrawer jobId={openJobId} onClose={() => setOpenJobId(undefined)} onSelect={setOpenJobId} />}`.

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/job-detail-drawer.test.tsx
cd .. && git add web/src/features/ops/job-detail-drawer.tsx web/src/features/ops/jobs-tab.tsx web/src/features/ops/job-detail-drawer.test.tsx
git commit -m "feat(web): Job detail drawer + Runs deep-link + retriedFrom back-link (Slice 25b Incr 5)"
```

## Task 30: Job actions — cancel / resume / retry with optimistic UI [ADVERSARIAL-VERIFY — resume/checkpoint deep-link]

> **⚠ ADVERSARIAL-VERIFY (resume/checkpoint deep-link — the resume action must continue the run, not restart it).** **Naive failure mode:** wiring "resume" as a plain re-enqueue that mints a NEW run (losing the checkpoint) instead of `POST /api/jobs { resume: <runId> }`, which re-enqueues the EXISTING run so dispatch resumes from the last completed DAG node (no re-execution). The resume button MUST post `{ kind, resume: job.runId }` and then deep-link the drawer to that same `/runs/$runId` so the operator watches the continued run. **Acceptance:** the resume action calls `POST /api/jobs` with a `resume` field equal to the interrupted job's `runId` (asserted on the mocked fetch body); cancel/retry hit their own routes; each action optimistically flips the row's local status and reconciles on `refresh()`.

**Files:**
- Create: `web/src/features/ops/use-job-actions.ts`
- Modify: `web/src/features/ops/job-detail-drawer.tsx` (action buttons), `web/src/features/ops/jobs-tab.tsx` (optimistic status + refresh)
- Test: `web/src/features/ops/use-job-actions.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch` (`POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/retry`, `POST /api/jobs` with `{ kind, resume }`), `JobLaunchResponseSchema`, `JobStatusWire`, `JobKindWire`.
- Produces: `useJobActions(refresh)` → `{ cancel(job), resume(job), retry(job) }`. `cancel` → `POST /api/jobs/${id}/cancel`; `resume` → `POST /api/jobs { kind: job.kind, resume: job.runId }` (lineage-preserving DAG resume, D2/§11-adjacent); `retry` → `POST /api/jobs/${id}/retry` (lineage). Each returns after the request and triggers `refresh()`. The drawer/table apply an optimistic local status flip immediately, reconciled on the next `refresh()`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/use-job-actions.test.tsx`:
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJobActions } from './use-job-actions.ts';

const interrupted = { id: 'job-9', kind: 'crew', runId: 'run-abc', status: 'interrupted' };

function Probe() {
  const { resume } = useJobActions(() => {});
  return <button type="button" data-testid="go" onClick={() => resume(interrupted as never)}>go</button>;
}

describe('useJobActions.resume', () => {
  it('POSTs /api/jobs with {resume: runId} (continue, not restart)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jobId: 'job-10', runId: 'run-abc' }), { status: 202, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);
    screen.getByTestId('go').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ kind: 'crew', resume: 'run-abc' }); // continues the EXISTING run
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `web/src/features/ops/use-job-actions.ts`**:
```typescript
import type { JobDTO } from '@contracts';
import { JobLaunchResponseSchema } from '@contracts';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

const OkSchema = z.object({}).passthrough();

/** Job lifecycle actions (D2). `resume` re-enqueues the EXISTING run so dispatch
 *  continues from the last completed DAG node (checkpoint), NOT a fresh restart —
 *  it posts `{ kind, resume: runId }` to `POST /api/jobs`. `retry` is the
 *  lineage-preserving server route (§11). Each triggers `refresh()` to reconcile
 *  the optimistic status flip the table already applied. */
export function useJobActions(refresh: () => void) {
  async function cancel(job: JobDTO): Promise<void> {
    await apiFetch(`/jobs/${job.id}/cancel`, { method: 'POST', body: {}, schema: OkSchema });
    refresh();
  }
  async function resume(job: JobDTO): Promise<void> {
    await apiFetch('/jobs', {
      method: 'POST',
      body: { kind: job.kind, resume: job.runId },
      schema: JobLaunchResponseSchema,
    });
    refresh();
  }
  async function retry(job: JobDTO): Promise<void> {
    await apiFetch(`/jobs/${job.id}/retry`, { method: 'POST', body: {}, schema: JobLaunchResponseSchema });
    refresh();
  }
  return { cancel, resume, retry };
}
```

- [ ] **Step 4: Wire the buttons** — in `job-detail-drawer.tsx`, render the three `<Button>`s conditionally on status (`cancel` for `queued`/`running`; `resume` for `interrupted` with a `runId`; `retry` for `failed`/`canceled`/`interrupted`), calling the `useJobActions` methods and applying an optimistic local status. In `jobs-tab.tsx`, thread `refresh` from `useJobs` into `useJobActions` and let each action flip the row's local status immediately (a `Map<id, status>` overlay), cleared on `refresh()`.

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/use-job-actions.test.tsx
cd .. && git add web/src/features/ops/use-job-actions.ts web/src/features/ops/job-detail-drawer.tsx web/src/features/ops/jobs-tab.tsx web/src/features/ops/use-job-actions.test.tsx
git commit -m "feat(web): job cancel/resume/retry optimistic actions (Slice 25b Incr 5)"
```

## Task 31: Jobs-tab integration test (pagination + facets + optimistic) + boundary gate

**Files:**
- Create: `web/src/features/ops/jobs-tab.integration.test.tsx`

**Interfaces:**
- Consumes: `renderAt('/ops?tab=jobs')`, a stateful `fetch` mock that serves two pages and honours `?status=`.
- Produces: assertions that Next advances the cursor, a status facet re-queries with `?status=`, and an optimistic cancel flips the row before the reconcile fetch resolves.

- [ ] **Step 1: Write the integration test** — mock `fetch` with a small state machine: first `/jobs` → page 1 with a `nextCursor`; `/jobs?cursor=…` → page 2; `/jobs?status=failed` → only failed rows; `POST /jobs/:id/cancel` → 200. Assert: clicking Next shows page-2 rows; selecting the status facet issues a `?status=failed` request; clicking cancel on a running row shows `canceled` optimistically then reconciles. Run → PASS.

- [ ] **Step 2: Boundary gate — Increment 5** — `cd web && bun run typecheck && bun run test` → PASS; root `bun run check` → PASS.

- [ ] **Step 3: Gate + commit**
```bash
cd web && bun run test src/features/ops/jobs-tab.integration.test.tsx
cd .. && git add web/src/features/ops/jobs-tab.integration.test.tsx
git commit -m "test(web): Jobs tab pagination/facets/optimistic integration (Slice 25b Incr 5)"
```

---

# Increment 6 — Overview tab (three cards + redacted logs tail)

**Purpose (spec §5.6, D1, D6):** the health dashboard — Daemon / Queue / Recent-failures cards (card-lite, no charts) polling on `notifyConfig().pollMs`, plus a monospace redacted logs tail. Recent-failures rows carry one-click Resume (`Interrupted`) / Retry (`Failed`). Sonnet floor. Web gates.

## Task 32: `use-daemon-status.ts` + `use-queue-stats.ts` — polling hooks

**Files:**
- Create: `web/src/features/ops/use-daemon-status.ts`, `web/src/features/ops/use-queue-stats.ts`
- Test: `web/src/features/ops/use-daemon-status.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch`, `DaemonStatusDtoSchema`/`QueueStatsDtoSchema` (`@contracts`), `notifyConfig` (`web/src/shared/contract/client.ts`).
- Produces: `useDaemonStatus(): { status?: DaemonStatusDTO; error? }` and `useQueueStats(): { stats?: QueueStatsDTO; error? }` — each fetches on mount and re-fetches every `notifyConfig().pollMs` via `setInterval`, cleaned up on unmount, cancelled-flag guarded like `RunsArea`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/use-daemon-status.test.tsx`:
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDaemonStatus } from './use-daemon-status.ts';

function Probe() {
  const { status } = useDaemonStatus();
  return <div data-testid="pid">{status ? String(status.pid) : 'loading'}</div>;
}

describe('useDaemonStatus', () => {
  it('fetches daemon status on mount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      running: true, pid: 99, startedAt: 1, uptimeMs: 5,
      bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('pid')).toHaveTextContent('99'));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement both hooks** — `use-daemon-status.ts`:
```typescript
import type { DaemonStatusDTO } from '@contracts';
import { DaemonStatusDtoSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';

export function useDaemonStatus() {
  const [status, setStatus] = useState<DaemonStatusDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch('/daemon/status', { schema: DaemonStatusDtoSchema })
        .then((s) => !cancelled && setStatus(s))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'failed'));
    };
    load();
    const id = setInterval(load, notifyConfig().pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return { status, error };
}
```
`use-queue-stats.ts` is the identical shape against `/queue/stats` + `QueueStatsDtoSchema`, returning `{ stats, error }`.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/use-daemon-status.test.tsx
cd .. && git add web/src/features/ops/use-daemon-status.ts web/src/features/ops/use-queue-stats.ts web/src/features/ops/use-daemon-status.test.tsx
git commit -m "feat(web): daemon-status + queue-stats polling hooks (Slice 25b Incr 6)"
```

## Task 33: `overview-tab.tsx` — Daemon · Queue · Recent-failures cards

**Files:**
- Create: `web/src/features/ops/overview-tab.tsx`
- Modify: `web/src/features/ops/index.tsx` (render `<OverviewTab />`)
- Test: `web/src/features/ops/overview-tab.test.tsx` (new)

**Interfaces:**
- Consumes: `useDaemonStatus`/`useQueueStats` (T32), `useJobs` (T27, for the recent-failures list — filter `page.items` to `failed`/`interrupted`), `useJobActions` (T30, Resume/Retry), `JobStatusWire`.
- Produces: `OverviewTab` — three cards: **Daemon** (running/stopped + `pid` + humanized `uptimeMs`), **Queue** (per-status counts + `activeCount` "active workers" vs `counts.running` "running rows" labeled separately, D6/§7.2 + `concurrency`), **Recent failures** (last N `failed`/`interrupted` jobs, each with a one-click Resume [interrupted] / Retry [failed]). No charts (deferred). `data-testid="ops-overview"`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/overview-tab.test.tsx`: mock `fetch` to serve `/daemon/status` (running, pid 7, uptime), `/queue/stats` (counts + activeCount 2, concurrency 4), and `/jobs` (one failed job). Render `/ops` (default Overview). Assert the daemon card shows `pid 7`, the queue card shows both "active workers" and "running rows" labels distinctly, and the failed job appears in Recent failures with a Retry button. Run → FAIL first.

- [ ] **Step 2: Implement `overview-tab.tsx`** — three `<div>` cards in a responsive grid. Daemon card reads `status`; Queue card reads `stats` and renders `activeCount` and `counts[running]` under DISTINCT labels ("active workers" vs "running rows") — never summing or reconciling them (§7.2 discipline surfaced in the UI). Recent-failures maps `useJobs().page.items.filter(j => j.status === 'failed' || j.status === 'interrupted')` to rows with a Resume/Retry `<Button>` from `useJobActions`. Wrap the whole tab in nothing extra (the shell already gives it a `RegionErrorBoundary`); each card can be its own inner boundary if desired. Include the daemon-logs viewer mount point (T34 fills it).

- [ ] **Step 3: Wire into the shell** — replace the Overview panel stub with `<OverviewTab />`.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/overview-tab.test.tsx
cd .. && git add web/src/features/ops/overview-tab.tsx web/src/features/ops/index.tsx web/src/features/ops/overview-tab.test.tsx
git commit -m "feat(web): Overview tab daemon/queue/recent-failures cards (Slice 25b Incr 6)"
```

## Task 34: `daemon-logs.tsx` — monospace redacted tail viewer + copy-CLI guidance

**Files:**
- Create: `web/src/features/ops/daemon-logs.tsx`
- Modify: `web/src/features/ops/overview-tab.tsx` (mount `<DaemonLogs />`)
- Test: `web/src/features/ops/daemon-logs.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch` (`GET /api/daemon/logs?tail=&stream=`), `DaemonLogsResponseSchema`, `notifyConfig` (poll), `Button`.
- Produces: `DaemonLogs` — a monospace `<pre>` tail (out/err stream toggle), poll-refreshed, plus static "stop the daemon from the CLI: `agent daemon stop`" copy-only guidance (NO remote-stop button, D6). `data-testid="ops-daemon-logs"`.

- [ ] **Step 1: Write the failing test** — mock `fetch` for `/daemon/logs` → `{ lines: ['run-1 ok', 'run-2 ok'] }`; render inside Overview; assert both lines render in `ops-daemon-logs` and that NO button labelled "Stop daemon" exists (`expect(screen.queryByRole('button', { name: /stop daemon/i })).toBeNull()`). Run → FAIL first.

- [ ] **Step 2: Implement `daemon-logs.tsx`** — fetch on mount + `setInterval(notifyConfig().pollMs)` (like T32), render `lines.join('\n')` in a `<pre className="overflow-x-auto font-mono text-xs">`, an out/err `<select>` or two-`<Button>` toggle, and a static guidance block with the CLI command in a `<code>`. NO stop button anywhere.

- [ ] **Step 3: Wire into Overview** — mount `<DaemonLogs />` at the bottom of `OverviewTab`.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/daemon-logs.test.tsx
cd .. && git add web/src/features/ops/daemon-logs.tsx web/src/features/ops/overview-tab.tsx web/src/features/ops/daemon-logs.test.tsx
git commit -m "feat(web): redacted daemon-logs tail + copy-CLI stop guidance (Slice 25b Incr 6, D6)"
```

## Task 35: Boundary gate — Increment 6

**Files:** none (verification only).

- [ ] **Step 1: Web + root gate** — `cd web && bun run typecheck && bun run test` → PASS; root `bun run check` → PASS. Re-check budget.

---

# Increment 7 — Devices & Access tab (bind posture · pair/QR · revoke · rotate)

**Purpose (spec §5.7, D4, D5, §7.1):** the remote-access story in the browser — bind posture + Tailscale/Cloudflare recipe cards, device sessions list with pairing (URL + self-contained QR) and revoke, and the break-glass root rotate behind a strong confirm. The QR is produced by the Vite-bundled `qrcode` dependency (self-contained, NOT a CDN). Sonnet floor. Web gates.

## Task 36: Pairing-token bootstrap (client) + `use-devices.ts`

**Files:**
- Modify: `web/src/shared/contract/client.ts` (`sessionToken()` prefers a stored paired token; a bootstrap that reads the `#token=` fragment)
- Modify: `web/src/main.tsx` (call the bootstrap before mount) — verify the exact entry filename (`web/src/main.tsx` or `web/src/app/main.tsx`); wire wherever `createRoot(...).render` lives
- Create: `web/src/features/ops/use-devices.ts`
- Test: `web/src/shared/contract/pairing-bootstrap.test.ts` (new), `web/src/features/ops/use-devices.test.tsx` (new)

**Interfaces:**
- Consumes: `apiFetch` (`GET /api/devices`, `POST /api/devices`, `POST /api/devices/:id/revoke`, `POST /api/security/rotate-root`), `DeviceListResponseSchema`/`DevicePairResponseSchema` (`@contracts`), `localStorage`.
- Produces: `adoptPairingTokenFromHash(): void` — on load, if `location.hash` matches `#token=<t>`, `localStorage.setItem('agent.pairedToken', t)` and strip the hash; `sessionToken()` returns the stored paired token when present, else `window.__AGENT_TOKEN__` (so a phone that opened the pairing URL authenticates as the paired device). `useDevices(): { devices, error, pair, revoke, rotate, refresh }`.

- [ ] **Step 1: Write the failing bootstrap test** — `web/src/shared/contract/pairing-bootstrap.test.ts`:
```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { adoptPairingTokenFromHash, sessionToken } from './client.ts';

describe('pairing-token bootstrap', () => {
  beforeEach(() => localStorage.clear());
  it('adopts a #token= fragment into localStorage and strips it', () => {
    window.location.hash = '#token=abc.def.sig';
    adoptPairingTokenFromHash();
    expect(sessionToken()).toBe('abc.def.sig');
    expect(window.location.hash).toBe('');
  });
  it('falls back to window.__AGENT_TOKEN__ when no paired token is stored', () => {
    (window as unknown as { __AGENT_TOKEN__?: string }).__AGENT_TOKEN__ = 'srv-token';
    expect(sessionToken()).toBe('srv-token');
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement the bootstrap** — in `web/src/shared/contract/client.ts`:
```typescript
const PAIRED_TOKEN_KEY = 'agent.pairedToken';

/** A phone that opens the pairing URL (`…/#token=<t>`) adopts that token once,
 *  into localStorage, then strips the fragment (so it never lingers in history).
 *  The token rode the URL FRAGMENT, never a query — fragments do not reach the
 *  server or its access logs. Call once at app boot, before the first apiFetch. */
export function adoptPairingTokenFromHash(): void {
  try {
    const m = window.location.hash.match(/^#token=(.+)$/);
    if (!m || !m[1]) return;
    localStorage.setItem(PAIRED_TOKEN_KEY, m[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // no window/localStorage (SSR/tests without a DOM) — nothing to adopt
  }
}
```
Change `sessionToken()` to prefer the stored paired token:
```typescript
export function sessionToken(): string {
  try {
    const paired = localStorage.getItem(PAIRED_TOKEN_KEY);
    if (paired) return paired;
  } catch {
    // fall through to the injected server token
  }
  const w = globalThis as { window?: { __AGENT_TOKEN__?: string } };
  return w.window?.__AGENT_TOKEN__ ?? '';
}
```
In `web/src/main.tsx`, call `adoptPairingTokenFromHash()` before `createRoot(...).render(...)`.

- [ ] **Step 4: Implement `use-devices.ts`**:
```typescript
import type { DeviceDTO } from '@contracts';
import { DeviceListResponseSchema, DevicePairResponseSchema } from '@contracts';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

const OkSchema = z.object({}).passthrough();
const RotateSchema = z.object({ token: z.string() });

export function useDevices() {
  const [devices, setDevices] = useState<DeviceDTO[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/devices', { schema: DeviceListResponseSchema })
      .then((r) => !cancelled && setDevices(r.items))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'failed'));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);
  return {
    devices,
    error,
    refresh,
    pair: (label: string) =>
      apiFetch('/devices', { method: 'POST', body: { label }, schema: DevicePairResponseSchema }).then((r) => {
        refresh();
        return r; // {deviceId, token, pairingUrl} — shown ONCE by the dialog
      }),
    revoke: (deviceId: string) =>
      apiFetch(`/devices/${deviceId}/revoke`, { method: 'POST', body: {}, schema: OkSchema }).then(refresh),
    rotate: (rootSecret: string) =>
      apiFetch('/security/rotate-root', { method: 'POST', body: { rootSecret }, schema: RotateSchema }).then((r) => {
        // Adopt the re-minted local token so the current tab survives (§7.1e).
        try {
          localStorage.setItem('agent.pairedToken', r.token);
        } catch {
          /* ignore */
        }
        refresh();
        return r;
      }),
  };
}
```

- [ ] **Step 5: Write + run the `use-devices` test** — `web/src/features/ops/use-devices.test.tsx`: a Probe calling `useDevices`, mock `fetch` for `/devices` → one device, assert it renders. Run both new tests → PASS.

- [ ] **Step 6: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/shared/contract/pairing-bootstrap.test.ts src/features/ops/use-devices.test.tsx
cd .. && git add web/src/shared/contract/client.ts web/src/main.tsx web/src/features/ops/use-devices.ts web/src/shared/contract/pairing-bootstrap.test.ts web/src/features/ops/use-devices.test.tsx
git commit -m "feat(web): pairing-token bootstrap + useDevices hook (Slice 25b Incr 7)"
```

## Task 37: `devices-tab.tsx` — bind status + recipe cards + device sessions list + revoke

**Files:**
- Create: `web/src/features/ops/devices-tab.tsx`
- Modify: `web/src/features/ops/index.tsx` (render `<DevicesTab />`)
- Test: `web/src/features/ops/devices-tab.test.tsx` (new)

**Interfaces:**
- Consumes: `useDaemonStatus` (T32, for `status.bind`), `useDevices` (T36), `Button`.
- Produces: `DevicesTab` — three sections: **(a) Bind status** (from `status.bind`: `bind`, `allowedHosts`, `port`, `sessionTtlMs`, plus static Tailscale + Cloudflare copy-paste recipe cards), **(b) Device sessions** (the `useDevices().devices` list with a per-row Revoke `<Button>`, and a "Pair a device" button that opens the dialog — T38), **(c) Root token rotate** (a button opening the rotate confirm — T39). `data-testid="ops-devices"`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/devices-tab.test.tsx`: mock `fetch` for `/daemon/status` (bind `{bind:'127.0.0.1', allowedHosts:['ts.example'], port:4130, sessionTtlMs:1}`) and `/devices` (one device labelled "phone"). Render `/ops?tab=devices`. Assert: the bind section shows `127.0.0.1` and `ts.example`; the "phone" device row + its Revoke button render; a Tailscale recipe card is present. Run → FAIL first.

- [ ] **Step 2: Implement `devices-tab.tsx`** — three `<section>`s. Bind card lists the four bind fields from `useDaemonStatus().status?.bind`. Recipe cards are static `<pre>` copy-paste blocks (Tailscale `tailscale serve` + `AGENT_WEB_BIND`/`AGENT_WEB_ALLOWED_HOSTS` guidance; Cloudflare `cloudflared tunnel` guidance) — text only, matching the spec's D4 static-copy intent. Device list maps `useDevices().devices` to rows with `deviceId`/`label`/`createdAt`/`exp` + a Revoke `<Button onClick={() => revoke(d.deviceId)}>`. A "Pair a device" `<Button>` sets local state to open `<PairDeviceDialog>` (T38). A "Rotate root token" `<Button>` opens `<RotateRootDialog>` (T39). `data-testid="ops-devices"`.

- [ ] **Step 3: Wire into the shell** — replace the Devices panel stub with `<DevicesTab />`.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/devices-tab.test.tsx
cd .. && git add web/src/features/ops/devices-tab.tsx web/src/features/ops/index.tsx web/src/features/ops/devices-tab.test.tsx
git commit -m "feat(web): Devices tab bind status + recipes + sessions + revoke (Slice 25b Incr 7)"
```

## Task 38: `pair-device-dialog.tsx` — pair + self-contained QR (token shown once)

**Files:**
- Modify: `web/package.json` (add the bundled `qrcode` dependency — `cd web && bun add qrcode && bun add -d @types/qrcode`)
- Create: `web/src/features/ops/pair-device-dialog.tsx`
- Test: `web/src/features/ops/pair-device-dialog.test.tsx` (new)

**Interfaces:**
- Consumes: `useDevices().pair` (T36), the `Dialog` primitive (`web/src/shared/ui/dialog.tsx`), `Button`, `qrcode` (bundled — `import QRCode from 'qrcode'`; `QRCode.toDataURL(pairingUrl)` → a data-URI `<img>`, no network).
- Produces: `PairDeviceDialog({ open, onOpenChange })` — a label input + Pair button; on success renders the returned `token` in a copy field AND a QR `<img>` of `pairingUrl`, shown EXACTLY ONCE (it's never re-fetchable). Closing the dialog discards the token from state.

- [ ] **Step 1: Add the dependency** — `cd web && bun add qrcode && bun add -d @types/qrcode`. (Vite bundles it into the app — self-contained, NOT a CDN; satisfies the CSP/no-CDN constraint.)

- [ ] **Step 2: Write the failing test** — `web/src/features/ops/pair-device-dialog.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PairDeviceDialog } from './pair-device-dialog.tsx';

describe('PairDeviceDialog', () => {
  it('pairs and shows the token + QR exactly once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      deviceId: 'd-new', token: 'tok-123', pairingUrl: 'http://ts.example/#token=tok-123',
    }), { status: 202, headers: { 'content-type': 'application/json' } })));
    render(<PairDeviceDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('pair-label'), { target: { value: 'phone' } });
    fireEvent.click(screen.getByTestId('pair-submit'));
    await waitFor(() => expect(screen.getByTestId('pair-token')).toHaveValue('tok-123'));
    expect(screen.getByTestId('pair-qr')).toBeInTheDocument(); // <img> data-URI, no network
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 3: Implement `pair-device-dialog.tsx`** — a `Dialog` with a label `<input data-testid="pair-label">` + `<Button data-testid="pair-submit">Pair</Button>`. On submit, `const res = await pair(label)`, store `res` in state; render `<input data-testid="pair-token" readOnly value={res.token}>` + a copy button, and `<img data-testid="pair-qr" src={dataUrl} alt="pairing QR" />` where `dataUrl` is computed via `QRCode.toDataURL(res.pairingUrl)` in an effect. A warning line: "This token is shown once — copy it now." Clear `res` on `onOpenChange(false)`.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/pair-device-dialog.test.tsx
cd .. && git add web/package.json web/bun.lock web/src/features/ops/pair-device-dialog.tsx web/src/features/ops/pair-device-dialog.test.tsx
git commit -m "feat(web): pair-device dialog + self-contained bundled QR (Slice 25b Incr 7, D4)"
```

## Task 39: `rotate-root-dialog.tsx` — break-glass rotate behind a strong confirm

**Files:**
- Create: `web/src/features/ops/rotate-root-dialog.tsx`
- Modify: `web/src/features/ops/devices-tab.tsx` (mount it)
- Test: `web/src/features/ops/rotate-root-dialog.test.tsx` (new)

**Interfaces:**
- Consumes: `useDevices().rotate` (T36), `Dialog`, `Button`.
- Produces: `RotateRootDialog({ open, onOpenChange })` — a strong confirm: a warning ("This logs out EVERY other device and cannot be undone"), a required `rootSecret` `<input type="password">`, and a typed-confirmation gate (the Rotate button is disabled until the user types `ROTATE`). On submit calls `rotate(rootSecret)`; on `401` surfaces "wrong root secret"; on success shows "rotated — other devices signed out" (the current tab keeps working via the re-minted token adopted in `useDevices.rotate`).

- [ ] **Step 1: Write the failing test** — mock `fetch` for `/security/rotate-root` → `{ token: 'new-local' }`. Render the dialog open; assert the Rotate button is disabled until `ROTATE` is typed AND a secret is entered; fill both, submit, assert success text renders and the mocked POST body was `{ rootSecret: 'S' }`. Also assert a `401` response surfaces the wrong-secret error. Run → FAIL first.

- [ ] **Step 2: Implement `rotate-root-dialog.tsx`** — a `Dialog` with the warning, a `<input type="password" data-testid="rotate-secret">`, a `<input data-testid="rotate-confirm">` gate, and `<Button disabled={confirm !== 'ROTATE' || !secret} data-testid="rotate-submit">`. On click: `try { await rotate(secret); setDone(true) } catch (e) { if (e instanceof ApiError && e.status === 401) setErr('wrong root secret') }`. Import `ApiError` from the client.

- [ ] **Step 3: Wire into Devices tab** — mount `<RotateRootDialog>` gated by the Devices-tab "Rotate root token" button state.

- [ ] **Step 4: Run — verify green** → PASS.

- [ ] **Step 5: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/rotate-root-dialog.test.tsx
cd .. && git add web/src/features/ops/rotate-root-dialog.tsx web/src/features/ops/devices-tab.tsx web/src/features/ops/rotate-root-dialog.test.tsx
git commit -m "feat(web): rotate-root confirm dialog (Slice 25b Incr 7, D5)"
```

## Task 40: Devices integration test (pair renders once, revoke removes row) + boundary gate

**Files:**
- Create: `web/src/features/ops/devices-tab.integration.test.tsx`

**Interfaces:**
- Consumes: `renderAt('/ops?tab=devices')`, a stateful `fetch` mock (`/devices` list grows on POST, shrinks on revoke).
- Produces: assertions that pairing adds a row + shows the token/QR once, and revoking removes the row on the next list refresh.

- [ ] **Step 1: Write the integration test** — stateful mock: `GET /devices` returns the current list; `POST /devices` mints `{deviceId:'d2', token, pairingUrl}` and grows the list; `POST /devices/d2/revoke` shrinks it. Assert: open pair dialog → submit → token+QR shown → device row appears; click Revoke → row disappears after refresh. Run → PASS.

- [ ] **Step 2: Boundary gate — Increment 7** — `cd web && bun run typecheck && bun run test` → PASS; root `bun run check` → PASS.

- [ ] **Step 3: Gate + commit**
```bash
cd web && bun run test src/features/ops/devices-tab.integration.test.tsx
cd .. && git add web/src/features/ops/devices-tab.integration.test.tsx
git commit -m "test(web): Devices pair/revoke integration (Slice 25b Incr 7)"
```

---

# Increment 8 — Triggers stub (DESIGNED, read-only empty-state)

**Purpose (spec §5.8, D3):** render the intended Triggers IA read-only so the four-tab shell is complete and the shape is reviewed early. NO backend, NO endpoints, NO contract additions — Slice 25 replaces the empty-state with live data. Sonnet floor. Web gates.

## Task 41: `triggers-tab.tsx` — static empty-state

**Files:**
- Create: `web/src/features/ops/triggers-tab.tsx`
- Modify: `web/src/features/ops/index.tsx` (render `<TriggersTab />`)
- Test: `web/src/features/ops/triggers-tab.test.tsx` (new)

**Interfaces:**
- Consumes: nothing (static component — no `apiFetch`).
- Produces: `TriggersTab` — the intended IA rendered read-only: a trigger-list header (columns cron / webhook / event → target `JobKind`) with an empty-state card "Triggers arrive in Slice 25." Explicitly a stub. `data-testid="ops-triggers"`.

- [ ] **Step 1: Write the failing test** — `web/src/features/ops/triggers-tab.test.tsx`:
```typescript
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('TriggersTab', () => {
  it('renders the designed-but-stubbed empty-state', async () => {
    renderAt('/ops?tab=triggers');
    expect(await screen.findByTestId('ops-triggers')).toBeInTheDocument();
    expect(screen.getByText('Triggers arrive in Slice 25.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify it fails** → FAIL.

- [ ] **Step 3: Implement `triggers-tab.tsx`** — a static `<section data-testid="ops-triggers">` with a column-header row (Type · Target job kind · Schedule) and an empty-state card containing the exact copy "Triggers arrive in Slice 25." No data fetching, no state. A short explanatory sub-line that this screen previews the Slice-25 trigger backend.

- [ ] **Step 4: Wire into the shell** — replace the Triggers panel stub with `<TriggersTab />`.

- [ ] **Step 5: Run — verify green** → PASS.

- [ ] **Step 6: Gate + commit**
```bash
cd web && bun run typecheck && bun run test src/features/ops/triggers-tab.test.tsx
cd .. && git add web/src/features/ops/triggers-tab.tsx web/src/features/ops/index.tsx web/src/features/ops/triggers-tab.test.tsx
git commit -m "feat(web): Triggers tab designed-but-stubbed empty-state (Slice 25b Incr 8, D3)"
```

## Task 42: Boundary gate — Increment 8

**Files:** none (verification only).

- [ ] **Step 1: Web + root gate** — `cd web && bun run typecheck && bun run test` → PASS (all four tabs live: Overview, Jobs, Devices, Triggers-stub); root `bun run check` → PASS. Re-check budget.

---

# Increment 9 — Docs (4 surfaces) + SDD ledger + live-verify + land

**Purpose (spec §8, §10, CLAUDE.md hard line):** update all four living surfaces truthfully (audited against the diff, not just "touched"), seed + close the SDD ledger, run the whole-branch adversarial review, pass the mandatory live-verify gate on the target box, and land `--no-ff` with README + ROADMAP + ledger in the same push (the slice-landing gate). The **Fable** capstone review (T49) is mandatory for the pairing/rotate/registry security surface.

## Task 43: `docs/architecture.md` — Queue stats + Daemon HTTP + device-registry + trusted-local + web Ops node + Slice-26 overlap

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/README.md` (doc-map pointer — only if a new living doc was added; this plan + spec are not living docs, so likely no map change; verify)

**Interfaces:**
- Consumes: the shipped code (Increments 1–8). The doc must MATCH the code, not the plan — audit each claim against the actual signatures (this is where a wrong edge is caught, per the Slice-9 audit).
- Produces: doc deltas — **Queue** subsystem gains `JobStore.stats()` + the `/api/queue/stats` route; **Daemon** subsystem gains the HTTP `/api/daemon/status` (uptime/bind) + `/api/daemon/logs` (redacted tail) surfaces on top of the CLI-only lifecycle; the **server perimeter/auth** section gains the **device registry** (`~/.agent/devices.json`, the first *positive* device list beside the negative `revoked-devices.json`), the `trusted-local` privileged-write gate, and the pairing/revoke/rotate-root + lineage-retry routes wired into `app.ts`; a **new `web/` Ops console** node in the frontend module map (`web/src/features/ops/`, four tabs, the new contract DTOs it consumes). Note the **Slice-26 overlap** (this slice delivers remote-auth's UI half, so Slice 26 narrows to any residual backend-only hardening).

- [ ] **Step 1: Update `architecture.md`** — the Queue/Daemon/server-auth sections + the web module map + the Mermaid module-map & data-flow node/edge updates (Ops-console web node; daemon/queue HTTP edges; `devices.json` node). Add the Slice-26-overlap note. Audit every module path + signature against the code.
- [ ] **Step 2: `bun run docs:check`** — must pass (no orphaned living doc; every `src/<subsystem>` documented — the new `src/server/devices/` + `src/server/security/{trusted-local,rotate,rotate-route,device-registry}.ts` live under already-documented `src/server`).
- [ ] **Step 3: Commit** `docs(architecture): Queue stats + Daemon HTTP + device-registry + Ops web node (Slice 25b Incr 9)` — do NOT push yet (the slice-landing gate needs README + ROADMAP + ledger in the SAME push; land together in T49).

## Task 44: Root `README.md` — Status line + slice-status table row + feature paragraph

**Files:** Modify: `README.md`

- [ ] **Step 1:** Update the **Status line** to Slice 25b shipped; add the **slice-status table** row (Slice 25b — Jobs & Triggers Ops Console — ✅ Done); add a feature paragraph describing the Ops console (daemon/queue health, job lifecycle actions, device pairing/revoke, root rotate, redacted logs; Triggers designed-stubbed); update any "Next" line to the next slice in the committed sequence. Audit the claims against the shipped code.
- [ ] **Step 2: Commit** `docs(readme): Slice 25b Ops console status + slice row + feature paragraph (Slice 25b Incr 9)` (do not push yet).

## Task 45: `docs/ROADMAP.md` — new Slice 25b row + flip markers

**Files:** Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** Add the new **Slice 25b** row; flip the shipped-capability markers (🟡/❌ → ✅ shipped, Slice 25b) in the gap table, the phase table, and the recommended sequence — for: web ops surface for the daemon/queue, per-device pairing/revoke UI, break-glass root rotate UI, redacted logs tail. Narrow the **Slice 26** row to any residual backend-only remote-auth hardening (the UI half shipped here). Keep the **Triggers backend** (Slice 25) still open/❌ (only the stubbed IA shipped).
- [ ] **Step 2: Commit** `docs(roadmap): Slice 25b row + flip ops-console markers + narrow Slice 26 (Slice 25b Incr 9)` (do not push yet).

## Task 46: SDD ledger — `.superpowers/sdd/progress.md` §"SLICE 25b" seed + closeout

**Files:** Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Seed (do this at Increment 1 start, retroactively fine here):** append a `## SLICE 25b — Jobs & Triggers Ops Console` section with the 9-increment task ledger skeleton.
- [ ] **Step 2: Closeout:** fill the per-task / review / fix / landing entries (the continuity record a fresh session resumes from) — the Increment-3 Fable security-review findings + fixes, the §7.1 acceptance results, and the T48 live-verify results. Note the Slice-26 overlap (remote-auth UI half shipped).
- [ ] **Step 3: Commit** `chore(sdd): Slice 25b ledger seed + closeout (Slice 25b Incr 9)` (do not push yet — lands in T49).

## Task 47: Regenerate the architecture-snapshot Artifact

**Files:**
- Create/Modify: the Artifact source per memory `reference-artifact-regen-mechanics` (data-driven arrays; `node --check`; referential-integrity + real test-count gate)

**Interfaces:**
- Consumes: the finalized `architecture.md` (T43), the real test count (`bun run test` + `cd web && bun run test` counts).
- Produces: the regenerated snapshot Artifact with a NEW **Ops-console** web node + the daemon/queue HTTP edges + the `devices.json` node; updated footer slice count ("25b") + test count; published update-in-place to the same URL (per the Artifact regen mechanics — url form `claude.ai/code/artifact/<uuid>`).

- [ ] **Step 1:** Regenerate from `architecture.md`; run the referential-integrity + real-test-count gate (`node --check`); publish update-in-place.
- [ ] **Step 2: Commit** any Artifact source file `docs(artifact): Slice 25b snapshot regen (Ops-console + devices node) (Slice 25b Incr 9)`.

## Task 48: Live-verify gate on the target box (§10 — MANDATORY before merge)

**Files:** none (manual runbook; record results in the ledger, T46).

**Interfaces:**
- Consumes: the built branch on the Mac Mini M4 Pro (memory `target-hardware-m4-pro`), the real daemon under launchd + real Ollama + native `/chrome` (logged-in session), a fake second device.
- Produces: the five §10 gates PASSED and recorded:
  1. **Jobs lifecycle** — enqueue a crew job → watch it appear + advance in the **Jobs** tab → **cancel** a running one → sees `Canceled` → **resume** an `Interrupted`-with-checkpoint job → confirm it continues from its last DAG node (NO re-execution).
  2. **Overview** — daemon card shows running + pid + a plausible uptime; queue counts match the Jobs tab; a `Failed` job shows in Recent failures with a working Retry.
  3. **Device pairing** — from the trusted local browser, **pair** a fake 2nd device → listed in Devices & Access with its label → opening the pairing URL/QR authenticates a second client hitting `GET /api/jobs` → **revoke** it → that client now gets `401`.
  4. **Daemon status + logs** — the logs tail renders recent lines with NO token substrings; the "stop" guidance is copy-only (no remote-stop button exists).
  5. **Rotate root (break-glass)** — rotate → confirm every OTHER device session is invalidated (`401`) while the current operator tab keeps working (re-minted session).

- [ ] **Step 1:** Run all five on the target box against real models + real Chrome (not mocks — Slice-13 lesson, memory `feedback-live-verify-before-merge`). Record pass/fail + evidence in the ledger. Any failure blocks merge and loops back to the owning increment.

## Task 49: Whole-branch adversarial review + land (`--no-ff`, slice-landing gate) [FABLE capstone]

**Files:** none (review + merge).

**Interfaces:**
- Consumes: the full branch diff. Run the whole-branch fan-out review (correctness / security / docs-accuracy) — **Fable-powered ultracode** per the model-tiering rule; the security review is MANDATORY for the pairing/rotate/registry + trusted-local surface (§7.1). The docs-accuracy pass audits the four surfaces against the diff (not just "touched").
- Produces: a merged, pushed slice. The pre-push slice-landing gate requires `README.md`, `docs/ROADMAP.md`, and `.superpowers/sdd/progress.md` all updated in the SAME push (T44/T45/T46) alongside `docs/architecture.md` (T43) — they are; so the push passes without `DOCS_OK=1`.

- [ ] **Step 1:** Address review findings (re-review, never soften — memory `feedback-plan-sample-code-review-rigor`). Pay special attention to: the rotate root-getter change (`session-token.ts`) keeping every existing session test green; the trusted-local gate not accidentally blocking the legitimate local browser over a configured tunnel; the QR dependency being bundled (not a CDN) in the built output.
- [ ] **Step 2: Final full gate** — `bun run check` AND `cd web && bun run typecheck && bun run test` → PASS.
- [ ] **Step 3: Merge + push**
```bash
git checkout main
git merge --no-ff slice-25b-ops-console -m "merge: Slice 25b — Jobs & Triggers Ops Console (web companion to Slice 24)"
git push   # slice-landing gate verifies README + ROADMAP + ledger + architecture.md all present in this push
```
- [ ] **Step 4:** Confirm the push passed the gate (no `DOCS_OK=1` needed) and the Artifact is live.

---

## Spec-coverage map (self-review — every D1–D6 · §7 hard-part · §11 → a task)

| Spec ref | Where covered |
|---|---|
| D1 (Overview = health cards, card-lite, no charts, poll on notifyConfig().pollMs) | T32 (hooks), T33 (three cards), T34 (logs) |
| D1 endpoints (`GET /api/daemon/status` extend, `GET /api/queue/stats`, new DTOs) | T3 (DTOs), T8 (queue stats), T9 (daemon status) |
| D2 (Jobs = table + drawer + cancel/resume/retry, keyset load-more, deep-link) | T27–T31; `availableAt` T1; `origin` facet T2 |
| D3 (Triggers designed-but-stubbed, no backend) | T41 |
| D4 (Devices: bind status + recipes; pair URL+QR; revoke; device registry) | T13 (registry), T16 (list), T17 (pair), T18 (revoke), T36–T38 (web) |
| D5 (security posture: trusted-local + rotate re-confirm root secret) | T14 (trusted-local + isLoopbackHost), T19 (rotate; session root getter from T15/T20), T20b (loopback-only local-token injection), T21 (acceptance) |
| D6 (daemon read-only status + logs tail; NO remote start/stop) | T9 (status), T10 (logs), T34 (copy-CLI, no stop button) |
| §7.1 device-pairing security (IDOR / trusted-local / no-token-leak / rotate self-survival) | T13, T14, T17, T18, T19, T20b (no 'local' token to remote index loads), T21 (Fable acceptance) |
| §7.2 queue-stats race (single-query, activeCount distinct) | T7 (adversarial), surfaced in UI T33 |
| §7.3 daemon uptime (pid mtime) + logs redaction | T9 (uptime), T10 (redaction) |
| §7 resume/checkpoint deep-link | T30 (adversarial — resume posts `{resume: runId}`, deep-links `/runs/$runId`) |
| §8 architecture-doc note | T43 |
| §8 telemetry note (ops.devices.pair/revoke, security.rotate-root, daemon.status/logs.read, queue.stats.read, ATTR.DEVICE_ID) | T8, T9, T10, T15 |
| §10 live-verify (5 gates) | T48 |
| §11 lineage-preserving retry (`retried_from` col + `JobDto.retriedFrom` + `POST /api/jobs/:id/retry`) | T1 (col+DTO), T20 (route), surfaced T29 (drawer back-link)/T30 (action) |
| §6 web IA wiring (nav, /ops route, ?tab=, ⌘K, RegionErrorBoundary per panel) | T23, T24, T25 |

**Adversarial-verify-flagged tasks:** T7 (§7.2 queue-stats race, Opus/ultracode), T9 (§7.3a uptime), T10 (§7.3b logs redaction), T13 (device-registry, Opus), T14 (trusted-local + isLoopbackHost, Opus), **T17 / T18 / T19 (pair / revoke / rotate-root — Fable)**, **T20b (loopback-only local-token injection — Fable)**, **T21 (§7.1 security acceptance — Fable)**, T30 (resume/checkpoint deep-link), **T49 (whole-branch capstone — Fable)**.

**Task count:** 50 tasks (Tasks 1–49 plus the inserted sub-task **T20b**, in Increment 3). Increment 3 therefore runs T13–T22 (11 tasks: T13–T20, T20b, T21, T22). No numeric per-increment total appears elsewhere in the plan to update.

**Resolved during self-review:**
1. **`GET /api/daemon/status` "extend" vs "add".** The spec's gap table says "extend" but there is NO existing HTTP `/api/daemon/status` route today (only `daemon/core.ts status()`, CLI-only). Resolved: T9 ADDS the HTTP route with the extended payload (`startedAt`/`uptimeMs`/`bind`) — "extend" refers to the payload shape beyond `{running, pid?}`, not an existing route.
2. **Rotate + captured root token (CRITICAL — would make rotate-root a no-op).** `createSessionTokenStore` captured `rootToken` by value, so a naive `rotate()` left the live session store signing/verifying with the OLD root — rotate-root did nothing in production. Resolved end-to-end: **T15** changes `rootToken: string` → `string | (() => string)`, resolved per-call in `sign`/`verify` (real before/after code); **T20** constructs the live store as `rootToken: () => rootStore.getOrCreateRoot()` at the single `main.ts` construction site, sharing the one `rootStore` that `deps.rootTokens` points at (so both standalone and daemon boot honour it); **T19**'s `ctx()` and **T21**'s `bootOpsServer` build their session stores with the getter so the post-rotate assertions (old token dies, re-minted local token verifies) are a real backstop, not vacuous. Flagged for the T49 Fable review.
3. **Pairing token transport.** The paired device must carry its token as a Bearer, but the SPA reads `window.__AGENT_TOKEN__`. Resolved in T36: the pairing URL carries the token in the `#fragment` (never a query — fragments don't reach the server/logs); a bootstrap adopts it into `localStorage` and `sessionToken()` prefers it. This is the concrete mechanism the §10.3 live-verify ("open the pairing URL/QR authenticates a second client") depends on.
4. **QR "self-contained".** Resolved in T38: the `qrcode` npm dep is Vite-BUNDLED into the app (self-contained in the built output, NOT a `<script src="cdn">`), satisfying the CSP/no-CDN constraint. A hand-rolled inline encoder was rejected as ~300 lines for no benefit over a bundled MIT dep.
5. **Kind/priority facets client-side.** `GET /api/jobs` (`JobListQuerySchema`) server-filters by `status` ONLY. Resolved in T27: `status` is the server facet; `kind`/`priority` filter the returned page client-side — no contract change, matching the existing `RunListQuery` precedent (which also mixes server + client facets).
6. **No spec requirement left unmapped.** Every D-decision, §7 hard part, §8 note, §10 gate, and the §11 retry lineage maps to a task above. No invented scope beyond the spec (the `qrcode` dep, the `AGENT_WEB_PUBLIC_URL` config row, and the pairing-fragment bootstrap are the minimal enablers the spec's own requirements imply, each flagged here).
7. **Injected `'local'` token defeating trusted-local over a tunnel (CRITICAL).** `deps.indexHtml` baked the `'local'` session token at boot and served it to EVERY client, so a remote client over an allowed tunnel host could read `window.__AGENT_TOKEN__`, become `principal === 'local'`, and (pre-fix) pass `requireTrustedLocal` on the tunnel-inclusive `hostAllowed`. Resolved with two independent backstops: **T14** tightens `requireTrustedLocal` to require `isLoopbackHost(req)` (a new shared `origin.ts` helper) — an allowed tunnel host is no longer sufficient; **T20b** stops handing the `'local'` token to non-loopback clients at all (per-request `indexFor`/`injectLocalToken` inject `window.__AGENT_TOKEN__` only when `isLoopbackHost(req)`; remote clients get the token-less base and must pair via the `#fragment` bootstrap). New acceptance case (7) in **T21** + the tunnel-replay case in **T14** exercise it.
8. **New ops `ServerDeps` fields must be optional (would break ≥12 fixtures).** The 7 threaded fields (`queueConcurrency`, `daemonPidPath`, `bindInfo`, `daemonLogDir`, `deviceRegistry`, `rootTokens`, `publicBaseUrl`) plus `localToken` (T20b) are all declared **optional** (`?:`, the `runLimiter?`/`sessionTokens?`/`staticDir?` precedent), so existing `const deps: ServerDeps = {…}` fixtures compile **unedited** and the T8 wiring compiles before T11/T20 populate real values. Each route narrows the optional field(s) it needs via the shared `need(...)` helper (T8), which both satisfies the handlers' non-optional `Deps` shapes (fixing the `sessionTokens?` optionality mismatch on pair/rotate) and degrades to a clean **503** (`DepUnavailableError`) when a dep is unwired — no fixture edits required.

---

## Execution handoff

Plan complete. Two execution options: **(1) Subagent-Driven (recommended)** — a fresh subagent per task (Sonnet floor; Opus for T13/T14 + seam reviews; Fable adversarial-verify for T17/T18/T19/T21/T49), two-stage review between tasks. **(2) Inline Execution** — batch with checkpoints via `superpowers:executing-plans`. Cut the `slice-25b-ops-console` branch off `main` and auto-commit the spec + this plan first.
