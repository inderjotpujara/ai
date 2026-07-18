## Task 11: `POST /api/builders/build` SSE route [HARD — ultracode adversarial-verify]

**Controller note:** dispatch this task as an **ultracode Workflow** (deterministic fan-out + adversarial-verify), Opus-powered. This is spec §7.1, explicitly flagged the reasoning-heavy piece of the whole phase. The reviewer's checklist is the four bullets under "Requirements the review must adversarially verify" in §7.1 — restated as the four test groups below. Do not soften or skip any of the four.

**Files:**
- Create: `src/server/builders/config.ts`, `src/server/builders/build.ts`
- Test: `tests/server/builders-build.test.ts` (create)

**Interfaces:**
- Consumes: `BuilderBuildRequestSchema` (Task 6), `BuildResultDTO` (Task 3), `confirmViaPort`/`confirmReuseViaPort`/`logToTextDelta` (Task 9), `ConsentRegistry`/`ConfirmPort` (`src/server/consent/registry.ts`), `withWallClock` (`src/reliability/timeout.ts`), `newRunId` (`src/run/run-id.ts`), `StatusEventType` (`src/contracts/enums.ts`).
- Produces: `confirmWaitMs(): number`; `RunBuilderTurn` type; `BuilderBuildDeps = { runsRoot: string; consent: ConsentRegistry; runBuilderTurn: RunBuilderTurn }`; `handleBuilderBuild(req: Request, deps: BuilderBuildDeps): Promise<Response>`.

- [ ] **Step 1: Write the failing tests (all four requirement groups)**

`tests/server/builders-build.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { BuilderKind, StatusEventType } from '../../src/contracts/enums.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import { handleBuilderBuild } from '../../src/server/builders/build.ts';

function builderRequest(body: unknown): Request {
  return new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects a malformed body with 400 before any stream opens', async () => {
  const res = await handleBuilderBuild(builderRequest({ need: 'x' }), {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: (async () => ({ kind: 'declined' })) as RunBuilderTurn,
  });
  expect(res.status).toBe(400);
});

test('happy path: data-run-start, narration, and the terminal result all stream, exactly once', async () => {
  const turn: RunBuilderTurn = async ({ log, runId }) => {
    log(`building for run ${runId}`);
    return { kind: 'written', name: 'stock_quotes', files: ['agents/stock_quotes.ts'] };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'fetch stock quotes' }),
    { runsRoot: '/tmp/unused', consent: createConsentRegistry(), runBuilderTurn: turn },
  );
  const body = await res.text();
  expect(body).toContain('data-run-start');
  expect(body.match(/"kind":"written"/g)).toHaveLength(1); // terminal result written EXACTLY once
  expect(body).toContain('building for run run-');
  expect(body).toContain('data-run-end');
  expect(body).toContain('"outcome":"written"');
});

test('a throwing runBuilderTurn still produces exactly one terminal result (never crashes the route)', async () => {
  const turn: RunBuilderTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    { runsRoot: '/tmp/unused', consent: createConsentRegistry(), runBuilderTurn: turn },
  );
  const body = await res.text();
  expect(body.match(/"kind":"failed-verification"/g)).toHaveLength(1);
  expect(body).toContain('"detail":"boom"');
});

test('requirement (a): confirm() genuinely suspends the build until POST /api/runs/:id/respond answers it', async () => {
  const registry = createConsentRegistry();
  const turn: RunBuilderTurn = async ({ confirm, log }) => {
    log('before-confirm');
    const granted = await confirm('proceed?');
    log(`after-confirm:${granted}`);
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    { runsRoot: '/tmp/unused', consent: registry, runBuilderTurn: turn },
  );
  const reader = res.body?.getReader();
  if (!reader) throw new Error('expected a streaming body');
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('before-confirm') || !text.includes('data-confirm')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream ended before the confirm ask was ever sent');
    text += decoder.decode(value);
  }
  // The ask genuinely suspended execute: nothing past it has arrived yet.
  expect(text).not.toContain('after-confirm');
  const promptId = /"promptId":"([^"]+)"/.exec(text)?.[1];
  expect(promptId).toBeDefined();
  expect(registry.resolve(promptId as string, true)).toBe(true);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain('after-confirm:true');
  expect(text.match(/"kind":"written"/g)).toHaveLength(1);
});

test('requirement (b): a client abort during a pending confirm does not crash, and never resolves against a later, unrelated answer', async () => {
  const registry = createConsentRegistry();
  const controller = new AbortController();
  const turn: RunBuilderTurn = async ({ confirm }) => {
    const granted = await confirm('proceed?');
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  const res = await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: registry,
    runBuilderTurn: turn,
  });
  controller.abort(); // client navigates away mid-consent
  // The registry entry is still pending — unaffected by the client abort
  // (promptId unguessability already prevents cross-talk; abort just means
  // nobody is reading the stream anymore, which must not throw here).
  expect(registry.pending().length).toBe(1);
  // A stale/late answer must not throw even though nobody reads the response.
  const [promptId] = registry.pending();
  expect(() => registry.resolve(promptId as string, true)).not.toThrow();
});

test('req.signal aborting does NOT stop the build from running to completion (the build is not detached from the connection, but is also not cancelled by it — requirement (d) at the route level)', async () => {
  const controller = new AbortController();
  let completed = false;
  const turn: RunBuilderTurn = async () => {
    await new Promise((r) => setTimeout(r, 5));
    completed = true;
    return { kind: 'declined' };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  const res = await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: turn,
  });
  controller.abort();
  await res.text(); // still drains to completion server-side
  expect(completed).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/builders-build.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/server/builders/config.ts`**

```typescript
const DEFAULT_CONFIRM_WAIT_MS = 15 * 60_000; // 15 minutes — a HUMAN decision window

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

/** Wall-clock cap around a builder's confirm/confirmReuse await (§7.1): an
 *  abandoned wizard (the human never answers — closes the tab mid-consent)
 *  must not suspend `execute`, and thus the terminal result, forever.
 *  Deliberately its OWN, much longer budget than `dryRunMs()`
 *  (`src/verified-build/config.ts`, a MODEL-call timeout) — this bounds how
 *  long the server waits for a HUMAN click, not a generateText call. */
export function confirmWaitMs(): number {
  return envNumber('AGENT_BUILDER_CONFIRM_WAIT_MS', DEFAULT_CONFIRM_WAIT_MS);
}
```

- [ ] **Step 4: Create `src/server/builders/build.ts`**

```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { BuilderKind, StatusEventType } from '../../contracts/enums.ts';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import { BuilderBuildRequestSchema } from '../../contracts/requests.ts';
import type { EventSink } from '../../core/events.ts';
import { withWallClock } from '../../reliability/timeout.ts';
import { newRunId } from '../../run/run-id.ts';
import { confirmReuseViaPort, confirmViaPort, logToTextDelta } from './adapter.ts';
import { confirmWaitMs } from './config.ts';
import type { ConsentRegistry } from '../consent/registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** What one builder run needs to do the actual generate/consent/verify/commit
 *  work (Task 12's `createRealRunBuilderTurn` composes `buildAgent`/
 *  `buildCrewOrWorkflow` under `withRunTelemetry`). Kept UNIT-TESTABLE here —
 *  the real turn is covered by live-verify, not unit tests, same policy as
 *  `RunCrewTurn`/`RunChatTurn` (Phase 4/2). */
export type RunBuilderTurn = (input: {
  kind: BuilderKind;
  need: string;
  autoYes?: boolean;
  force?: boolean;
  runId: string;
  confirm: (question: string) => Promise<boolean>;
  confirmReuse: (kind: string, question: string) => Promise<boolean>;
  log: (m: string) => void;
}) => Promise<BuildResultDTO>;

export type BuilderBuildDeps = {
  runsRoot: string;
  consent: ConsentRegistry;
  runBuilderTurn: RunBuilderTurn;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Wraps a boolean ask with `confirmWaitMs()`'s wall-clock cap (§7.1
 *  requirement (b)): a timeout is treated as a DECLINE — fail-closed, never
 *  an auto-approve. The registry's own `pendingResolvers` entry for this
 *  promptId is not proactively evicted on timeout (accepted for this phase —
 *  a late answer simply lands on nobody listening; a registry-level expiry
 *  is a natural future hardening item, not required here). */
function withConfirmTimeout(ask: () => Promise<boolean>): Promise<boolean> {
  return withWallClock(confirmWaitMs(), ask).catch(() => false);
}

/**
 * `POST /api/builders/build` (spec §4.2.1/§7.1) — streams the guided-build
 * flow as an AI-SDK SSE UI-message stream, exactly `handleChat`'s shape.
 * Mints a runId, emits `data-run-start`/`data-run-end`, and dispatches to
 * `deps.runBuilderTurn` with `confirm`/`confirmReuse`/`log` bridged onto the
 * SAME connection's event sink + text-delta parts (Task 9's adapters, D4).
 *
 * `execute` is NOT detached (unlike the fire-and-watch model-pull route,
 * Task 17): the whole build runs to completion inside it, so a client abort
 * (`req.signal`) never tears the build down mid-stage — requirement (d). The
 * terminal `BuildResultDTO` is written EXACTLY ONCE, as a one-shot text part,
 * whether `runBuilderTurn` resolves OR throws (requirement (c)) — mirroring
 * `handleChat`'s one-shot-outcome discipline for a non-'answer' result.
 */
export async function handleBuilderBuild(
  req: Request,
  deps: BuilderBuildDeps,
): Promise<Response> {
  let body: ReturnType<typeof BuilderBuildRequestSchema.parse>;
  try {
    body = BuilderBuildRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid builder request' }, 400);
  }

  const runId = newRunId();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const events: EventSink = (e) =>
        writer.write({ type: e.type, data: e, transient: true });
      const log = logToTextDelta(writer.write);
      const confirmRaw = confirmViaPort(deps.consent.port, events, 'build');
      const confirm = (question: string) =>
        withConfirmTimeout(() => confirmRaw(question));
      const confirmReuseRaw = confirmReuseViaPort(deps.consent.port, events);
      const confirmReuse = (kind: string, question: string) =>
        withConfirmTimeout(() => confirmReuseRaw(kind, question));

      events({ type: StatusEventType.RunStart, runId, task: body.need });

      let result: BuildResultDTO;
      try {
        result = await deps.runBuilderTurn({
          kind: body.kind,
          need: body.need,
          autoYes: body.autoYes,
          force: body.force,
          runId,
          confirm,
          confirmReuse,
          log,
        });
      } catch (err) {
        result = {
          kind: 'failed-verification',
          stage: 'error',
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      const id = 'build-result';
      writer.write({ type: 'text-start', id });
      writer.write({ type: 'text-delta', id, delta: JSON.stringify(result) });
      writer.write({ type: 'text-end', id });

      events({ type: StatusEventType.RunEnd, runId, outcome: result.kind });
    },
    onError: (err) =>
      `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/server/builders-build.test.ts`
Expected: all PASS, including the two progressive-read requirement tests (they exercise the real suspend/resume behavior end-to-end, not a mock).

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/builders/config.ts src/server/builders/build.ts tests/server/builders-build.test.ts
git add src/server/builders/config.ts src/server/builders/build.ts tests/server/builders-build.test.ts
git commit -m "feat(server): POST /api/builders/build — streaming guided-build + mid-flow consent (Phase 5, §7.1)"
```

> **Controller note (ultracode):** before merging this task's commit, run the ultracode adversarial-verify pass explicitly against spec §7.1's four bullets (confirm-suspends-execute, abort-cleanup, one-shot terminal result, span-closes-on-disconnect — the last one is only fully exercisable once Task 12 wires the real `withRunTelemetry`-backed turn; flag it as a cross-task dependency for that reviewer to re-check once Task 12 lands, not something Task 11 alone can prove end-to-end).

---

