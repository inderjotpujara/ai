## Task 9: Increment-1 completion gate (full regression, no docs edit)

**Files:** none created/modified — this task is a verification-only checkpoint before handing off to Increment 2.

**Interfaces:** none new — this task only proves Tasks 1-8's combined surface is internally consistent and does not regress anything else in the repo.

- [ ] **Step 1: Full typecheck + lint across everything touched this increment**

```bash
bun run typecheck
bun run lint:file -- src/contracts/dto.ts src/contracts/requests.ts src/config/schema.ts src/session/migrations.ts src/session/store.ts tests/contracts/session-dto.test.ts tests/contracts/session-requests.test.ts tests/config/schema.test.ts tests/session/migrations.test.ts tests/session/store.test.ts
```
Expected: both clean (0 errors).

- [ ] **Step 2: Full contracts + config + session suites**

```bash
bun test tests/contracts/ tests/config/ tests/session/
```
Expected: all PASS, including every PRE-EXISTING contracts test (e.g. `step-kind-parity`, `degrade-kind-parity`, `verified-level-parity`, `reuse-kind-parity`, `run-kind-build-pull`, `proposal-dto`) — this increment only ADDS schemas/config entries/a new module; it must not touch or break any existing one.

- [ ] **Step 3: Full repo test suite (final regression gate for the increment)**

Run: `bun test`
Expected: PASS — this increment's changes are additive-only (new exports, one new `CONFIG_SPEC` entry, a new `src/session/` module with no import from anywhere else in the tree yet), so nothing outside `tests/contracts/`, `tests/config/`, `tests/session/` should be affected. If anything outside those three directories fails, STOP and investigate before proceeding — it means an edit leaked scope beyond this increment's files.

- [ ] **Step 4: Self-review checklist (perform before considering Increment 1 done)**

- **Spec coverage (§5 item 1, D1, D4, D10, §4.1, §4.3):** `SessionListItemDtoSchema`/`SessionDtoSchema` ✓ (Task 1); `SessionListQuerySchema`/`SessionListResponseSchema`/`SessionRenameRequestSchema` ✓ (Task 2); `AGENT_SESSIONS_PATH` ✓ (Task 3); `SESSION_MIGRATIONS` ✓ (Task 4); `createSessionStore` + all 7 methods (`upsertSession`, `getSession`, `renameSession`, `deleteSession`, `listSessions`, `appendMessage`, `getMessages`) + `close` ✓ (Tasks 5-8). NOT in scope for this increment (confirmed absent from the diff): `ChatRequestSchema.sessionId` regex (D2 — Increment 2), any `src/server/**` route, any `src/cli/**` wiring, `MemoryStore.rememberOnce` (D6 — Increment 3), any `web/**` change.
- **Placeholder scan:** every code block in Tasks 1-8 is complete, runnable TypeScript — no `// TODO`, no `...`, no stub function bodies. (Verified by re-reading each Step 3/code step above during drafting.)
- **Type consistency:** `SessionRow`/`StoredMessage` (engine, `src/session/store.ts`) use camelCase field names matching `SessionListItemDTO`/`ChatMessageDTO` (contracts) exactly where the concepts overlap (`id`, `title`, `owner`, `createdAt`, `updatedAt`, `lastMessageAt`, `runId`) — a later server-side mapper (Increment 2) can project 1:1 without renaming. `noUncheckedIndexedAccess` is satisfied throughout: every `page[page.length - 1]`-style access is bound to a checked local (`lastRaw`) before use; every zod-optional field is typed `| undefined`, never silently assumed present.
- **Known forward-item flagged for Increment 2 (see Task 7's design note):** `appendMessage`'s locked signature carries no `runId`, so `sessions.run_id` stays `NULL` throughout Increment 1 even though spec §4.3 describes `appendMessage` as touching it — Increment 2 must decide how `run_id` actually gets populated (extend `appendMessage`, or add a small `setRunId` method) before `SessionListItemDTO.runId`/`SessionDTO.runId` can ever be non-empty on the wire.

- [ ] **Step 5: No commit for this task** — Task 9 is a verification checkpoint only; if Steps 1-3 are clean, Increment 1 is complete and ready for hand-off to the Increment 2 plan (chat persistence wiring). If anything fails, fix it under the FAILING task's own commit (amend that task's diff before moving on), not as a new catch-all commit here.

---

## Increment 1 — final produced surface (for the Increment 2-6 controller to reconcile against)

**Contracts (`src/contracts/dto.ts`, `src/contracts/requests.ts`, both re-exported via `src/contracts/index.ts`'s existing wildcard):**
- `SessionListItemDtoSchema` / `type SessionListItemDTO = { id: string; title: string; owner: string; createdAt: number; updatedAt: number; lastMessageAt?: number; runId?: string }`
- `SessionDtoSchema` / `type SessionDTO = SessionListItemDTO & { messages: ChatMessageDTO[] }`
- `SessionListQuerySchema` / `type SessionListQuery = { search?: string; limit: number /* default 25, coerced, 1-200 */; cursor?: string }`
- `SessionListResponseSchema` / `type SessionListResponse = { items: SessionListItemDTO[]; nextCursor?: string; total: number }`
- `SessionRenameRequestSchema` / `type SessionRenameRequest = { title: string /* 1-200 chars */ }`

**Config (`src/config/schema.ts`):**
- `AGENT_SESSIONS_PATH` (string, default `'sessions'`) — new `CONFIG_SPEC` entry, picked up automatically by `loadConfig()`.

**Engine (`src/session/migrations.ts`, `src/session/store.ts`):**
- `SESSION_MIGRATIONS: Migration[]` — one migration, `'init-sessions-and-messages'` (`sessions` + `messages` tables + `idx_messages_session` index).
- `type SessionRow = { id: string; title: string; owner: string; createdAt: number; updatedAt: number; lastMessageAt: number | undefined; runId: string | undefined }`
- `type StoredMessage = { id: string; sessionId: string; parentMessageId: string | undefined; role: string; parts: unknown; createdAt: number; degraded: boolean | undefined }`
- `type SessionStoreDeps = Record<string, never>`
- `function createSessionStore(config: { path?: string }, deps: SessionStoreDeps)` returning:
  - `upsertSession(id: string, opts: { defaultTitle: string; at: number }): void`
  - `getSession(id: string): SessionRow | undefined`
  - `renameSession(id: string, title: string, at: number): void`
  - `deleteSession(id: string): void`
  - `listSessions(q: { search?: string; cursor?: string; limit: number }): { items: SessionListItemDTO[]; nextCursor?: string; total: number }`
  - `appendMessage(sessionId: string, msg: { id: string; role: string; parts: unknown; parentMessageId?: string; degraded?: boolean }, at: number): void`
  - `getMessages(sessionId: string): StoredMessage[]`
  - `close(): void`
- `type SessionStore = ReturnType<typeof createSessionStore>`

**Open item for Increment 2:** `sessions.run_id` / `SessionRow.runId` / `SessionListItemDTO.runId` are all wired end-to-end at the schema/column level but nothing in Increment 1 ever WRITES a non-null `run_id` — `upsertSession` doesn't set it and `appendMessage`'s locked signature has no `runId` field to write. Increment 2 must add the write path (signature extension or a new method) before a session's `runId` can appear on the wire.


---

# Part A2 — Increments 2–3: Chat persistence wiring + Recall / auto-ingest (Tasks T20–T32)

## Task T20: `ChatRequestSchema.sessionId` gains a UUID-v4 regex (D2)

**Files:**
- Modify: `src/contracts/requests.ts` (the existing `ChatRequestSchema`, currently lines 36–44)
- Test: `tests/contracts/chat-request-session-id.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ChatRequestSchema.sessionId` still `.optional()`, now additionally `.regex(...)` — matches exactly what `crypto.randomUUID()` produces (RFC 4122 v4: 8-4-4-4-12 hex groups, version nibble `4`, variant nibble in `[89ab]`). A malformed id is rejected by the SAME `ChatRequestSchema.parse(...)` call `handleChat` already makes — no separate validation branch (D2).

- [ ] **Step 1: Write the failing tests**

`tests/contracts/chat-request-session-id.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import { ChatRequestSchema } from '../../src/contracts/requests.ts';

const messages = [
  { id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
];

test('accepts a real crypto.randomUUID() v4 sessionId', () => {
  const id = crypto.randomUUID();
  const parsed = ChatRequestSchema.parse({ messages, sessionId: id });
  expect(parsed.sessionId).toBe(id);
});

test('accepts a request with no sessionId at all (still optional)', () => {
  const parsed = ChatRequestSchema.parse({ messages });
  expect(parsed.sessionId).toBeUndefined();
});

test('rejects a non-UUID sessionId', () => {
  expect(() =>
    ChatRequestSchema.parse({ messages, sessionId: 'not-a-uuid' }),
  ).toThrow();
});

test('rejects a UUID of the wrong version (v1, not v4)', () => {
  // v1 UUID shape: version nibble '1' instead of '4'.
  expect(() =>
    ChatRequestSchema.parse({
      messages,
      sessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    }),
  ).toThrow();
});

test('rejects an empty-string sessionId', () => {
  expect(() => ChatRequestSchema.parse({ messages, sessionId: '' })).toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/contracts/chat-request-session-id.test.ts`
Expected: FAIL on the two `.toThrow()` cases — the current schema has no regex, so a garbage string still parses.

- [ ] **Step 3: Add the regex to `src/contracts/requests.ts`**

Read the file first. Replace:
```typescript
export const ChatRequestSchema = z.object({
  messages: z.array(UiMessageLikeSchema),
  sessionId: z.string().optional(),
  /** Ids returned by a prior `POST /api/upload` (Slice 30b Phase 2, Task 16)
   *  — media-by-reference: the browser never sends a raw filesystem path,
   *  only the opaque id the upload endpoint minted. */
  uploadIds: z.array(z.string()).optional(),
});
```
with:
```typescript
/** Matches `crypto.randomUUID()`'s output shape (RFC 4122 v4): 8-4-4-4-12 hex
 *  groups, version nibble '4', variant nibble in [89ab]. Slice 30b Phase 6,
 *  D2 — the session id is client-minted; this is the ONLY validation gate
 *  before it's used as a SQLite primary key. */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ChatRequestSchema = z.object({
  messages: z.array(UiMessageLikeSchema),
  /** Client-minted via `crypto.randomUUID()` (D2); the server never mints
   *  one. A malformed id is rejected at this SAME parse call — no separate
   *  validation branch in `handleChat` (Slice 30b Phase 6). */
  sessionId: z.string().regex(SESSION_ID_PATTERN).optional(),
  /** Ids returned by a prior `POST /api/upload` (Slice 30b Phase 2, Task 16)
   *  — media-by-reference: the browser never sends a raw filesystem path,
   *  only the opaque id the upload endpoint minted. */
  uploadIds: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/contracts/chat-request-session-id.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Full contracts regression (nothing else references `sessionId` yet, but confirm)**

Run: `bun test tests/contracts`
Expected: PASS — no other test constructs a non-UUID `sessionId` value (grep confirms: only this new file and, later, `tests/server/chat-handler*.test.ts` reference it, and those are added in T26 with valid UUIDs).

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts tests/contracts/chat-request-session-id.test.ts
git add src/contracts/requests.ts tests/contracts/chat-request-session-id.test.ts
git commit -m "feat(contracts): ChatRequestSchema.sessionId gains a UUID-v4 regex (Phase 6 D2)"
```

---

## Task T21: `appendMessage` gains an optional `runId?` write path (closes Increment 1's flagged gap)

**Files:**
- Modify: `src/session/store.ts` (the `appendMessage` function, currently lines 141–170, and its `msg` parameter type)
- Modify: `tests/session/store.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: nothing new — this is the real, landed `src/session/store.ts` from Increment 1 (verified above).
- Produces: `appendMessage(sessionId: string, msg: { id: string; role: string; parts: unknown; parentMessageId?: string; degraded?: boolean; runId?: string }, at: number): void` — when `msg.runId` is present, `sessions.run_id` is updated to it; when absent, `run_id` is left COMPLETELY untouched (never cleared to `NULL` by a later runId-less call). This is the exact signature extension Increment 1's final report flagged as the one open item blocking `SessionListItemDTO.runId`/`SessionDTO.runId` from ever being non-empty on the wire.

- [ ] **Step 1: Write the failing tests**

Append to `tests/session/store.test.ts` (new `describe` block, after the existing `describe('listSessions', ...)` block — i.e. at the end of the file):
```typescript
describe('appendMessage runId write path (Phase 6 Incr 2 — closes Increment 1s flagged gap)', () => {
  beforeEach(() => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
  });

  test('appendMessage with runId writes sessions.run_id', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], runId: 'run-abc' },
      1_500,
    );
    expect(store.getSession('s1')?.runId).toBe('run-abc');
  });

  test('appendMessage without runId leaves sessions.run_id untouched (stays undefined)', () => {
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 1_500);
    expect(store.getSession('s1')?.runId).toBeUndefined();
  });

  test('a LATER appendMessage without runId does not CLEAR a previously-written runId', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], runId: 'run-abc' },
      1_000,
    );
    store.appendMessage('s1', { id: 'm2', role: 'user', parts: [] }, 2_000);
    expect(store.getSession('s1')?.runId).toBe('run-abc');
  });

  test('a LATER appendMessage with a NEW runId overwrites the previous one', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], runId: 'run-abc' },
      1_000,
    );
    store.appendMessage(
      's1',
      { id: 'm2', role: 'assistant', parts: [], runId: 'run-xyz' },
      2_000,
    );
    expect(store.getSession('s1')?.runId).toBe('run-xyz');
  });

  test('listSessions surfaces the written runId on SessionListItemDTO', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], runId: 'run-xyz' },
      1_000,
    );
    const page = store.listSessions({ limit: 10 });
    expect(page.items[0]?.runId).toBe('run-xyz');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — the first test (`runId writes sessions.run_id`) fails because `appendMessage`'s current type has no `runId` field (a TS compile error under `bun test`'s type-stripping would actually surface as a runtime pass-through since bun doesn't type-check test files at `bun test` time — but `bun run typecheck` WILL fail on this file until Step 3 lands; run `bun run typecheck` first to confirm the expected compile error, then `bun test` to see the assertion itself fail since `run_id` is never written).

- [ ] **Step 3: Extend `appendMessage` in `src/session/store.ts`**

Replace the `appendMessage` function (current lines 141–170) with:
```typescript
  function appendMessage(
    sessionId: string,
    msg: {
      id: string;
      role: string;
      parts: unknown;
      parentMessageId?: string;
      degraded?: boolean;
      runId?: string;
    },
    at: number,
  ): void {
    db.run(
      `INSERT OR IGNORE INTO messages
       (id, session_id, parent_message_id, role, parts, created_at, degraded)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        sessionId,
        msg.parentMessageId ?? null,
        msg.role,
        JSON.stringify(msg.parts),
        at,
        msg.degraded === undefined ? null : msg.degraded ? 1 : 0,
      ],
    );
    // Touch activity timestamps unconditionally; only touch run_id when the
    // caller actually supplied one — a runId-less call (e.g. the user-message
    // persist, which runs BEFORE the orchestrator even starts and so cannot
    // know a runId yet) must never CLEAR a run_id a prior call already wrote
    // (Phase 6 Incr 2, closes Increment 1's flagged gap).
    if (msg.runId !== undefined) {
      db.run(
        'UPDATE sessions SET updated_at = ?, last_message_at = ?, run_id = ? WHERE id = ?',
        [at, at, msg.runId, sessionId],
      );
    } else {
      db.run(
        'UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?',
        [at, at, sessionId],
      );
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: PASS (all 30 pre-existing + 5 new = 35 tests).

- [ ] **Step 5: Full session module regression**

Run: `bun test tests/session/`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/store.ts tests/session/store.test.ts
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): appendMessage gains an optional runId write path (Phase 6 Incr 2)"
```

---

## Task T22: `src/server/sessions/list.ts` — `GET /api/sessions`

**Files:**
- Create: `src/server/sessions/list.ts`
- Test: `tests/server/sessions-list.test.ts` (create)

**Interfaces:**
- Consumes: `SessionStore` (Increment 1, `src/session/store.ts`); `SessionListQuerySchema`/`SessionListResponseSchema` (already landed in `src/contracts/requests.ts`, re-exported via `src/contracts/index.ts`).
- Produces: `export type SessionsDeps = { sessionStore: SessionStore }` (the canonical Deps type every other `src/server/sessions/*.ts` file in this plan imports from THIS file, mirroring how `RunsDeps` lives in `src/server/runs/detail.ts` and `list.ts` imports it). `export function handleSessionList(params: URLSearchParams, deps: SessionsDeps): Response` — parses the query string, delegates straight to `SessionStore.listSessions` (already returns the full `{items, nextCursor?, total}` shape, `items` already `SessionListItemDTO[]` — no per-row mapping needed), re-validates against `SessionListResponseSchema`, 400s on a malformed query (bad `limit`).

- [ ] **Step 1: Write the failing tests**

`tests/server/sessions-list.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionList } from '../../src/server/sessions/list.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-list-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

test('GET /api/sessions returns an empty page for an empty store', async () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams(), {
      sessionStore: store,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lists sessions, honoring search + limit (delegates straight to SessionStore.listSessions)', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', {
      defaultTitle: 'Talking about cats',
      at: 1_000,
    });
    store.upsertSession('s2', {
      defaultTitle: 'Talking about dogs',
      at: 2_000,
    });
    const res = handleSessionList(
      new URLSearchParams({ search: 'cats', limit: '10' }),
      { sessionStore: store },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string }[];
      total: number;
    };
    expect(body.items.map((i) => i.id)).toEqual(['s1']);
    expect(body.total).toBe(1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed limit (non-numeric) is rejected with 400, not a 500', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams({ limit: 'abc' }), {
      sessionStore: store,
    });
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a limit above the 200 ceiling is rejected with 400', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionList(new URLSearchParams({ limit: '500' }), {
      sessionStore: store,
    });
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/server/sessions-list.test.ts`
Expected: FAIL — `src/server/sessions/list.ts` does not exist yet (module resolution error).

- [ ] **Step 3: Create `src/server/sessions/list.ts`**

```typescript
import { ZodError } from 'zod';
import {
  SessionListQuerySchema,
  SessionListResponseSchema,
} from '../../contracts/index.ts';
import type { SessionStore } from '../../session/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Shared by every `src/server/sessions/*.ts` handler in this plan — mirrors
 *  `RunsDeps`'s single-canonical-home precedent (`src/server/runs/detail.ts`). */
export type SessionsDeps = { sessionStore: SessionStore };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `GET /api/sessions?search=&cursor=&limit=` — a keyset-paged list of session
 * summaries (spec D10). `SessionStore.listSessions` (Increment 1) already
 * returns the FULL `{items, nextCursor?, total}` shape with `items` already
 * `SessionListItemDTO[]` — this handler only parses the query string and
 * re-validates the store's own output against the wire schema, matching
 * `handleRunList`'s division of labor (`src/server/runs/list.ts`).
 */
export function handleSessionList(
  params: URLSearchParams,
  deps: SessionsDeps,
): Response {
  let query: ReturnType<typeof SessionListQuerySchema.parse>;
  try {
    query = SessionListQuerySchema.parse({
      search: params.get('search') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }
  const page = deps.sessionStore.listSessions(query);
  return json(SessionListResponseSchema.parse(page), 200);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/server/sessions-list.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/sessions/list.ts tests/server/sessions-list.test.ts
git add src/server/sessions/list.ts tests/server/sessions-list.test.ts
git commit -m "feat(server): add handleSessionList for GET /api/sessions (Phase 6 Incr 2)"
```

---

## Task T23: `src/server/sessions/detail.ts` — `GET /api/sessions/:id`

**Files:**
- Create: `src/server/sessions/detail.ts`
- Test: `tests/server/sessions-detail.test.ts` (create)

**Interfaces:**
- Consumes: `SessionsDeps` (T22, `src/server/sessions/list.ts`); `StoredMessage` (Increment 1, `src/session/store.ts`); `SessionDtoSchema`/`ChatMessageDTO`/`SessionDTO` (`src/contracts/index.ts`); `ChatRole` (`src/contracts/enums.ts`).
- Produces: `export function handleSessionDetail(id: string, deps: SessionsDeps): Response` — 404 if `getSession` returns `undefined`, else the full `SessionDTO` (`{...row, messages}` per spec §4.2 item 2). `StoredMessage.parts` is `unknown` and `.role` is a bare `string` (Increment 1's documented gap) — this handler is what safely projects both into `ChatMessageDTO`'s typed `role`/`text` fields, via two small local helpers (`partsToText`, `toChatMessageDTO`) that do not assume the JSON shape.

- [ ] **Step 1: Write the failing tests**

`tests/server/sessions-detail.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatRole } from '../../src/contracts/enums.ts';
import { handleSessionDetail } from '../../src/server/sessions/detail.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-detail-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

test('404s for an unknown session id', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionDetail('nope', { sessionStore: store });
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the full transcript, mapping stored parts to ChatMessageDTO.text', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage(
      's1',
      {
        id: 'm1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'hello' }],
      },
      1_000,
    );
    store.appendMessage(
      's1',
      {
        id: 'm2',
        role: ChatRole.Assistant,
        parts: [{ type: 'text', text: 'hi there' }],
        degraded: true,
      },
      2_000,
    );
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      messages: {
        id: string;
        role: string;
        text: string;
        degraded?: boolean;
      }[];
    };
    expect(body.id).toBe('s1');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      id: 'm1',
      role: 'user',
      text: 'hello',
    });
    expect(body.messages[1]).toEqual({
      id: 'm2',
      role: 'assistant',
      text: 'hi there',
      degraded: true,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session with no messages yet returns an empty transcript, not an error', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed/unexpected stored parts shape degrades to empty text, never throws', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    // Simulate a corrupt/legacy row: parts is not the expected array shape.
    store.appendMessage(
      's1',
      { id: 'm1', role: ChatRole.User, parts: { unexpected: true } },
      1_000,
    );
    const res = handleSessionDetail('s1', { sessionStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { text: string }[] };
    expect(body.messages[0]?.text).toBe('');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/server/sessions-detail.test.ts`
Expected: FAIL — `src/server/sessions/detail.ts` does not exist yet.

- [ ] **Step 3: Create `src/server/sessions/detail.ts`**

```typescript
import type { ChatRole } from '../../contracts/enums.ts';
import {
  type ChatMessageDTO,
  SessionDtoSchema,
  type SessionDTO,
} from '../../contracts/index.ts';
import type { StoredMessage } from '../../session/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Flatten a stored message's raw `parts` (JSON-decoded, un-typed) into a
 *  single string — mirrors `src/server/chat/task.ts`'s `textOf`, but
 *  defensively: a malformed/legacy row degrades to `''` rather than
 *  throwing, since this reads data this SAME server wrote, not user input,
 *  but must still survive a future schema change to `parts`. */
function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) =>
      p &&
      typeof p === 'object' &&
      'text' in p &&
      typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text
        : '',
    )
    .join('');
}

function toChatMessageDTO(m: StoredMessage): ChatMessageDTO {
  return {
    id: m.id,
    // Stored `role` is a bare string, written only by `handleChat`
    // (Task T26) using `ChatRole`'s own enum values — trusted here rather
    // than re-validated against the enum on every read.
    role: m.role as ChatRole,
    text: partsToText(m.parts),
    ...(m.degraded !== undefined ? { degraded: m.degraded } : {}),
  };
}

/**
 * `GET /api/sessions/:id` — the full `SessionDTO` (session row + transcript),
 * or 404 if the id is unknown. `SessionRow`'s fields are already 1:1 with
 * `SessionListItemDtoSchema`'s (Increment 1's design note) — spread it
 * straight in, add the mapped `messages` (spec §4.2 item 2).
 */
export function handleSessionDetail(id: string, deps: SessionsDeps): Response {
  const row = deps.sessionStore.getSession(id);
  if (!row) return json({ error: 'not found' }, 404);
  const messages = deps.sessionStore.getMessages(id).map(toChatMessageDTO);
  const dto: SessionDTO = { ...row, messages };
  return json(SessionDtoSchema.parse(dto), 200);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/server/sessions-detail.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/sessions/detail.ts tests/server/sessions-detail.test.ts
git add src/server/sessions/detail.ts tests/server/sessions-detail.test.ts
git commit -m "feat(server): add handleSessionDetail for GET /api/sessions/:id (Phase 6 Incr 2)"
```

---

## Task T24: `src/server/sessions/rename.ts` + `src/server/sessions/delete.ts` — `PATCH`/`DELETE /api/sessions/:id`

**Files:**
- Create: `src/server/sessions/rename.ts`
- Create: `src/server/sessions/delete.ts`
- Test: `tests/server/sessions-mutate.test.ts` (create — covers both handlers; they're simple, symmetric mutation endpoints and share one fixture harness)

**Interfaces:**
- Consumes: `SessionsDeps` (T22, `src/server/sessions/list.ts`); `SessionRenameRequestSchema` (`src/contracts/index.ts`).
- Produces: `export function handleSessionRename(req: Request, deps: SessionsDeps, id: string): Promise<Response>` — 404 if the id is unknown (checked BEFORE the rename write, since `SessionStore.renameSession` is itself a silent no-op on a missing id per Increment 1's documented contract — this handler is what turns that into an observable 404), 400 on a malformed/non-JSON body, else `renameSession` + `{ok: true}` 200. `export function handleSessionDelete(deps: SessionsDeps, id: string): Response` — same 404-before-write discipline, else `deleteSession` (cascades `messages` in one transaction, Increment 1) + `{ok: true}` 200.

- [ ] **Step 1: Write the failing tests**

`tests/server/sessions-mutate.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionDelete } from '../../src/server/sessions/delete.ts';
import { handleSessionRename } from '../../src/server/sessions/rename.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

function makeStore(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-mutate-'));
  return { store: createSessionStore({ path: dir }, {}), dir };
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/sessions/s1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('PATCH renames an existing session and returns {ok:true}', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      patchRequest({ title: 'Renamed' }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.getSession('s1')?.title).toBe('Renamed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH on an unknown session id 404s (never renames a phantom row)', async () => {
  const { store, dir } = makeStore();
  try {
    const res = await handleSessionRename(
      patchRequest({ title: 'Renamed' }),
      { sessionStore: store },
      'nope',
    );
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH with a bad body (empty title) 400s', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      patchRequest({ title: '' }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH with a non-JSON body 400s', async () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const res = await handleSessionRename(
      new Request('http://localhost/api/sessions/s1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
      { sessionStore: store },
      's1',
    );
    expect(res.status).toBe(400);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DELETE removes a session and its messages (cascade), returning {ok:true}', () => {
  const { store, dir } = makeStore();
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 1_000);
    const res = handleSessionDelete({ sessionStore: store }, 's1');
    expect(res.status).toBe(200);
    expect(store.getSession('s1')).toBeUndefined();
    expect(store.getMessages('s1')).toEqual([]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DELETE on an unknown session id 404s', () => {
  const { store, dir } = makeStore();
  try {
    const res = handleSessionDelete({ sessionStore: store }, 'nope');
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/server/sessions-mutate.test.ts`
Expected: FAIL — neither `src/server/sessions/rename.ts` nor `src/server/sessions/delete.ts` exists yet.

- [ ] **Step 3: Create `src/server/sessions/rename.ts`**

```typescript
import { SessionRenameRequestSchema } from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `PATCH /api/sessions/:id` — renames a session. 404 if the id is unknown,
 * checked BEFORE the rename write: `SessionStore.renameSession` (Increment 1)
 * is itself a silent no-op on a missing id (a plain `UPDATE` with no matching
 * row), so this handler is what turns that into an observable 404 rather
 * than a misleading 200 for a rename that never happened.
 */
export async function handleSessionRename(
  req: Request,
  deps: SessionsDeps,
  id: string,
): Promise<Response> {
  if (!deps.sessionStore.getSession(id)) {
    return json({ error: 'not found' }, 404);
  }
  let body: ReturnType<typeof SessionRenameRequestSchema.parse>;
  try {
    body = SessionRenameRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  deps.sessionStore.renameSession(id, body.title, Date.now());
  return json({ ok: true }, 200);
}
```

- [ ] **Step 4: Create `src/server/sessions/delete.ts`**

```typescript
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `DELETE /api/sessions/:id` — cascades the session's messages in one
 * transaction (`SessionStore.deleteSession`, Increment 1). 404 if the id is
 * unknown, checked before the delete for the same observable-404 reason as
 * `handleSessionRename`.
 */
export function handleSessionDelete(deps: SessionsDeps, id: string): Response {
  if (!deps.sessionStore.getSession(id)) {
    return json({ error: 'not found' }, 404);
  }
  deps.sessionStore.deleteSession(id);
  return json({ ok: true }, 200);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/server/sessions-mutate.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/sessions/rename.ts src/server/sessions/delete.ts tests/server/sessions-mutate.test.ts
git add src/server/sessions/rename.ts src/server/sessions/delete.ts tests/server/sessions-mutate.test.ts
git commit -m "feat(server): add handleSessionRename/handleSessionDelete for PATCH/DELETE /api/sessions/:id (Phase 6 Incr 2)"
```

---

## Task T25: Wire `sessionStore` into `ServerDeps`/`app.ts`/`main.ts` — routes are live end-to-end

**Files:**
- Modify: `src/server/app.ts` (add `sessionStore: SessionStore` to `ServerDeps`; register the 4 routes)
- Modify: `src/server/main.ts` (construct `sessionStore` next to `memoryStore`; add to `deps`)
- Modify: `tests/server/app.test.ts`, `tests/server/phase4-routes.test.ts`, `tests/server/phase5-mcp-routes.test.ts`, `tests/server/phase5-memory-routes.test.ts`, `tests/server/runs-routes.test.ts` (each constructs a full `ServerDeps` object; each gains one throwing fake + one field, mirroring the exact precedent already set when `memoryStore` was added in Phase 5)
- Modify: `.gitignore` (anchor `/sessions/`, mirroring `/runs/`'s existing entry — `AGENT_SESSIONS_PATH` defaults to the relative `'sessions'`, so a real/default-config server run creates a `sessions/` dir at the repo root, exactly like `runs/` already does)
- Test: `tests/server/sessions-routes.test.ts` (create — end-to-end through `buildFetch`, proving the perimeter + route wiring, not just the handlers in isolation)

**Interfaces:**
- Consumes: `SessionStore` (Increment 1); `handleSessionList`/`SessionsDeps` (T22); `handleSessionDetail` (T23); `handleSessionRename`/`handleSessionDelete` (T24); `AGENT_SESSIONS_PATH` (already landed in `src/config/schema.ts`, Increment 1).
- Produces: `ServerDeps.sessionStore: SessionStore` (new required field — every real caller has one; test fixtures updated in this same task, matching the `memoryStore` precedent). Four new routes: `GET /api/sessions`, `GET /api/sessions/:id`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`. **Note for Increment 4:** `GET /api/sessions/:id/export` (spec §4.2 item 5) is NOT added by this task — when it is, it MUST be registered BEFORE the bare-`:id` regex below (the exact `stream`-before-`detail` ordering discipline `/api/runs/:id/stream` already established), or the bare-`:id` match would swallow `export` as a session id.

- [ ] **Step 1: Write the failing end-to-end route test**

`tests/server/sessions-routes.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'sessions-routes-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'sessions-routes-runs-'));
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('unused');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('unused');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('unused');
};
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('unused');
};
const unusedMemoryStore = {
  stats: async () => {
    throw new Error('unused');
  },
  recall: async () => {
    throw new Error('unused');
  },
  ingest: async () => {
    throw new Error('unused');
  },
} as unknown as MemoryStore;

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-routes-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(sessionStore: SessionStore): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: unusedRunCrewTurn,
    runWorkflowTurn: unusedRunWorkflowTurn,
    runBuilderTurn: unusedRunBuilderTurn,
    runModelPull: async () => {},
    freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    mcpConfigPath: mcpConfigPath(),
    mcpMountStatus: createMcpMountStatus(),
    mountOne: async () => ({ outcome: 'mounted' }),
    memoryStore: unusedMemoryStore,
    sessionStore,
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}

test('unauthenticated requests to every session route are 401 (perimeter gate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-perimeter-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    const fetch = buildFetch(deps(store));
    const noAuth = (path: string, init?: RequestInit): Request =>
      new Request(`http://localhost:0${path}`, {
        ...init,
        headers: { Host: 'localhost:0', ...(init?.headers ?? {}) },
      });
    expect((await fetch(noAuth('/api/sessions'))).status).toBe(401);
    expect((await fetch(noAuth('/api/sessions/s1'))).status).toBe(401);
    expect(
      (await fetch(noAuth('/api/sessions/s1', { method: 'PATCH', body: '{}' })))
        .status,
    ).toBe(401);
    expect(
      (await fetch(noAuth('/api/sessions/s1', { method: 'DELETE' }))).status,
    ).toBe(401);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sessions, GET/PATCH/DELETE /api/sessions/:id are wired end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-routes-live-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const fetch = buildFetch(deps(store));

    const listRes = await fetch(authGet('/api/sessions'));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: { id: string }[] };
    expect(listBody.items.map((i) => i.id)).toEqual(['s1']);

    const detailRes = await fetch(authGet('/api/sessions/s1'));
    expect(detailRes.status).toBe(200);

    const renameRes = await fetch(
      new Request('http://localhost:0/api/sessions/s1', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Host: 'localhost:0',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    );
    expect(renameRes.status).toBe(200);
    expect(store.getSession('s1')?.title).toBe('Renamed');

    const deleteRes = await fetch(
      new Request('http://localhost:0/api/sessions/s1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
      }),
    );
    expect(deleteRes.status).toBe(200);
    expect(store.getSession('s1')).toBeUndefined();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sessions/:id 404s for an unknown id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-404-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    const fetch = buildFetch(deps(store));
    const res = await fetch(authGet('/api/sessions/nope'));
    expect(res.status).toBe(404);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/server/sessions-routes.test.ts`
Expected: FAIL — `ServerDeps` has no `sessionStore` field yet (TS compile error via `bun run typecheck`; `bun test` itself will fail at the `deps()` object literal / route-not-found 404s from `app.ts` not recognizing `/api/sessions*` yet).

- [ ] **Step 3: Add `sessionStore` to `ServerDeps` and register the routes in `src/server/app.ts`**

Add these imports (alongside the existing handler imports, in the same alphabetically-grouped style):
```typescript
import { handleSessionDelete } from './sessions/delete.ts';
import { handleSessionDetail } from './sessions/detail.ts';
import { handleSessionList } from './sessions/list.ts';
import { handleSessionRename } from './sessions/rename.ts';
```
and
```typescript
import type { SessionStore } from '../session/store.ts';
```

Add one field to `ServerDeps` (right after the existing `memoryStore: MemoryStore;` line):
```typescript
  /** The session/chat-history store chat persistence + the Sessions UI read
   *  and write through (Slice 30b Phase 6). */
  sessionStore: SessionStore;
```

Register the four routes in `handleApi`, immediately after the existing `/api/memory/:space/ingest` block and before the final `rec.status(404); return json({ error: 'not found' }, 404);` fallback:
```typescript
        if (req.method === 'GET' && url.pathname === '/api/sessions') {
          rec.status(200);
          return handleSessionList(new URLSearchParams(url.search), deps);
        }
        // Bare-:id match shared by GET/PATCH/DELETE. NOTE for Increment 4:
        // when `/api/sessions/:id/export` is added, it MUST be registered
        // BEFORE this regex (the same stream-before-detail ordering
        // discipline as `/api/runs/:id/stream` above), or this bare-:id
        // match would swallow "export" as a session id.
        const sessionDetail = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
        if (req.method === 'GET' && sessionDetail?.[1]) {
          const res = handleSessionDetail(sessionDetail[1], deps);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'PATCH' && sessionDetail?.[1]) {
          const res = await handleSessionRename(req, deps, sessionDetail[1]);
          rec.status(res.status);
          return res;
        }
        if (req.method === 'DELETE' && sessionDetail?.[1]) {
          const res = handleSessionDelete(deps, sessionDetail[1]);
          rec.status(res.status);
          return res;
        }
```

- [ ] **Step 4: Construct `sessionStore` in `src/server/main.ts` and add it to `deps`**

Add the import:
```typescript
import { createSessionStore } from '../session/store.ts';
```

Insert the construction right after the existing `memoryStore` construction (after the `const memoryStore = createMemoryStore(...)` block, before `// Serve the real built app when it exists`):
```typescript
  // Cheap + synchronous, mirroring memoryStore's own construction discipline
  // just above (SqliteStore's constructor runs mkdirSync + opens the db +
  // migrates — no Ollama/network dependency at construction time).
  const sessionStore = createSessionStore(
    { path: String(cfg.AGENT_SESSIONS_PATH) },
    {},
  );
```

Add `sessionStore,` to the `deps: ServerDeps = { ... }` object literal (right after the existing `memoryStore,` line).

- [ ] **Step 5: Update the `.gitignore`**

Add, right after the existing `/memory/` block:
```
# Session/chat-history datastore (bun:sqlite; local, never committed). See docs/architecture.md
# Anchored to the repo root so src/session/ + tests/session/ stay tracked.
/sessions/
```

- [ ] **Step 6: Update the 5 pre-existing `ServerDeps` fixture builders (mirrors the exact precedent set when `memoryStore` was added in Phase 5)**

`tests/server/app.test.ts` — add the import `import type { SessionStore } from '../../src/session/store.ts';` alongside the existing `MemoryStore` import; add, right after the existing `unusedMemoryStore` block:
```typescript
// None of these tests exercise a session route either — same
// throwing-stub discipline as unusedMemoryStore above.
const unusedSessionStore = {
  listSessions: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  getSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  upsertSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  renameSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  deleteSession: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  appendMessage: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  getMessages: () => {
    throw new Error('sessionStore should not be invoked by these tests');
  },
  close: () => {},
} as unknown as SessionStore;
```
Then add `sessionStore: unusedSessionStore,` right after each of that file's THREE `memoryStore: unusedMemoryStore,` lines (the `deps`, `throwingDeps`, `confinedDeps`, and `symlinkDeps` object literals — four sites total).

`tests/server/phase4-routes.test.ts`, `tests/server/phase5-mcp-routes.test.ts` — each: add the same `import type { SessionStore } from '../../src/session/store.ts';` import and the same `unusedSessionStore` block (adjust the error message's file reference only if desired; the message text itself can stay identical), then add `sessionStore: unusedSessionStore,` right after that file's single `memoryStore: unusedMemoryStore,` line inside `function deps(): ServerDeps { return { ... } }`.

`tests/server/runs-routes.test.ts` — same pattern, but this file's throwing fakes use the bare `'unused'` message convention (matching `noMemoryStore`'s existing style) rather than the longer `'... should not be invoked by these tests'` text used elsewhere; name it `noSessionStore` to match `noMemoryStore`'s naming, and add `sessionStore: noSessionStore,` after the existing `memoryStore: noMemoryStore,` line in the single top-level `const deps: ServerDeps = { ... }`.

`tests/server/phase5-memory-routes.test.ts` — this file already exercises real memory routes with a `fakeMemoryStore` (not a throwing stub), but still never touches a session route: add the same throwing `unusedSessionStore` block + `import type { SessionStore }` + `sessionStore: unusedSessionStore,` in its `function deps(): ServerDeps`.

- [ ] **Step 7: Run every touched test file to verify PASS**

```bash
bun test tests/server/sessions-routes.test.ts tests/server/app.test.ts tests/server/phase4-routes.test.ts tests/server/phase5-mcp-routes.test.ts tests/server/phase5-memory-routes.test.ts tests/server/runs-routes.test.ts tests/server/main.test.ts
```
Expected: all PASS. `tests/server/main.test.ts` needs no source edit (it calls `startWebServer` directly, which now transitively constructs a real `sessionStore` the same way it already constructs a real `memoryStore`) — it is included here purely as a regression check that `startWebServer` still boots cleanly with the new construction in place.

- [ ] **Step 8: Full server-suite regression**

Run: `bun test tests/server/`
Expected: PASS — no other `tests/server/*.ts` file constructs a `ServerDeps` object literal (confirmed by the earlier `grep -rl "ServerDeps" tests` sweep — exactly the 5 files above, plus `sessions-routes.test.ts` itself).

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/app.ts src/server/main.ts tests/server/sessions-routes.test.ts tests/server/app.test.ts tests/server/phase4-routes.test.ts tests/server/phase5-mcp-routes.test.ts tests/server/phase5-memory-routes.test.ts tests/server/runs-routes.test.ts
git add src/server/app.ts src/server/main.ts .gitignore tests/server/sessions-routes.test.ts tests/server/app.test.ts tests/server/phase4-routes.test.ts tests/server/phase5-mcp-routes.test.ts tests/server/phase5-memory-routes.test.ts tests/server/runs-routes.test.ts
git commit -m "feat(server): wire sessionStore + the four /api/sessions routes into app.ts/main.ts (Phase 6 Incr 2)"
```

---

## Task T26 — **FLAGGED HARD → ultracode adversarial-verify (Opus-powered Workflow)**: `handler.ts` turn-boundary persistence (D3/D4/D7, spec §7.1)

> **This task's review is NOT a normal per-task gate.** Per this plan's Global Constraints and the spec's own build-order note (§5 item 2, §7.1), this task must be verified via the **ultracode Workflow-tool multi-agent orchestration** (deterministic fan-out + adversarial-verify stage, Opus-powered), not a single reviewing pass. The adversarial-verify stage MUST explicitly check each of spec §7.1's five requirements (a)–(e) below against the actual diff, not just "tests pass":
> - **(a)** The user-persist genuinely completes before the first token can reach the browser — no race where a fast first token beats the write.
> - **(b)** `req.signal` abort mid-turn does not leave persistence half-done — the assistant row is written in full or not at all, never partial/malformed `parts`.
> - **(c)** `upsertSession`'s `INSERT OR IGNORE` is genuinely a no-op on a repeat id (no constraint-violation throw turning a legitimate retry into a 500).
> - **(d)** `rememberOnce`'s hash+source dedup key cannot collide across DIFFERENT turns in the same session (this is actually Increment 3/T28's mechanism, but the assistant message id THIS task mints — `asst-${crypto.randomUUID()}` — is what makes that dedup key unique per turn; the reviewer must confirm this task mints a genuinely fresh id every turn, never reuses one).
> - **(e)** The dropped-stream case is a deliberately visible gap, not silent data loss: if the connection dies after the user row is written but before `runChatTurn` resolves, the assistant row is simply never written — `GET /api/sessions/:id` then shows a user turn with no reply, which is the locked "user regenerates" recovery path, not a bug.

**Files:**
- Modify: `src/server/chat/task.ts` (export `textOf`; add a new exported `latestUserMessage` helper — `buildTaskFromMessages` itself is UNCHANGED, zero regression risk to its existing behavior)
- Modify: `src/server/chat/handler.ts` (full-file replacement below — `ChatHandlerDeps` gains `sessionStore?: SessionStore`; `handleChat` gains the two-part turn-boundary persist)
- Test: `tests/server/chat-handler-persistence.test.ts` (create)

**Interfaces:**
- Consumes: `SessionStore` (Increment 1 + T21's `runId` extension); `latestUserMessage`/`textOf` (this task's own `task.ts` export); `StatusEventType`/`ChatRole` (`src/contracts/enums.ts`); `StatusEvent` (`src/contracts/events.ts`, for the `RunStart`/`Degrade` narrowing the `events` tap relies on).
- Produces: `ChatHandlerDeps.sessionStore?: SessionStore` — **optional**, mirroring `uploadsDir`'s established precedent exactly: pre-existing fakes/tests (`tests/server/chat-handler.test.ts`) that never touch persistence need supply nothing and keep passing UNMODIFIED; the real server (`main.ts`, via `ServerDeps` which structurally satisfies `ChatHandlerDeps` since `app.ts` passes `deps: ServerDeps` straight into `handleChat`) always has one. Turn-boundary behavior: (1) `upsertSession` + the user message `appendMessage` run as plain synchronous statements in `handleChat`'s own body, BEFORE `createUIMessageStream` is even constructed — trivially satisfying §7.1(a). (2) The assistant message `appendMessage` runs inside `execute`'s `try` block, immediately after `deps.runChatTurn(...)` resolves and reuses the SAME `result` value the existing outcome-text branch already computes — trivially satisfying §7.1(b)/(e) by placement (a throw skips it, going straight to `catch`). (3) `degradedThisTurn`/`capturedRunId` are captured via the SAME `events: EventSink` closure that already writes every `StatusEvent` to the stream — no new tap mechanism, reusing D7's precedent.

**Design note (why no `RunChatTurn`/`createRealRunChatTurn` signature change is needed for `sessionStore`, unlike `memoryStore` in Increment 3):** `app.ts`'s `handleApi` already calls `handleChat(req, deps)` passing the WHOLE `ServerDeps` object (`app.ts:135`), and TS structural typing means `ChatHandlerDeps`'s subset of fields (`runChatTurn`, `uploadsDir?`, now `sessionStore?`) is satisfied automatically as long as `ServerDeps` has them (T25 added `sessionStore: SessionStore` to `ServerDeps` in the previous task) — no threading through the per-request `RunChatTurn` call shape is required. This is DIFFERENT from `memoryStore` (Increment 3, T30), which genuinely must thread through `createRealRunChatTurn` because `injectRecall` runs one layer deeper, inside `runChatSession` itself (the CLI/server-shared engine seam), not inside `handleChat`.

- [ ] **Step 1: Extend `src/server/chat/task.ts`** (small, additive — read the file first; current content is 56 lines)

Change `function textOf(message: UiMessageLike): string {` to `export function textOf(message: UiMessageLike): string {` (the ONLY change to the existing code — `buildTaskFromMessages` itself is untouched).

Add this new function at the end of the file:
```typescript

/** The most recent `user`-role message, or undefined if there is none —
 *  shared by `handleChat`'s turn-boundary persistence (Slice 30b Phase 6,
 *  D3/D4), which needs the message object itself (id/role/parts) rather
 *  than `buildTaskFromMessages`'s flattened task string. */
export function latestUserMessage(
  messages: UiMessageLike[],
): UiMessageLike | undefined {
  const idx = messages.findLastIndex((m) => m.role === ChatRole.User);
  return idx === -1 ? undefined : messages[idx];
}
```

- [ ] **Step 2: Run the existing chat-task suite to confirm zero regression**

Run: `bun test tests/server/chat-task.test.ts`
Expected: PASS (unchanged — `buildTaskFromMessages`'s own logic was not touched, only exported an already-private helper and added one new function).

- [ ] **Step 3: Write the failing turn-boundary persistence tests**

`tests/server/chat-handler-persistence.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ChatRole, DegradeKind, StatusEventType } from '../../src/contracts/enums.ts';
import type { ChatRequest } from '../../src/contracts/requests.ts';
import { handleChat } from '../../src/server/chat/handler.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import type { SessionStore } from '../../src/session/store.ts';

const SESSION_ID = crypto.randomUUID();

type RecordedMessage = {
  sessionId: string;
  id: string;
  role: string;
  parts: unknown;
  degraded?: boolean;
  runId?: string;
};

function fakeSessionStore(): {
  store: SessionStore;
  calls: string[];
  sessions: Map<string, { title: string }>;
  messages: RecordedMessage[];
} {
  const calls: string[] = [];
  const sessions = new Map<string, { title: string }>();
  const messages: RecordedMessage[] = [];
  const store = {
    upsertSession: (id: string, opts: { defaultTitle: string; at: number }) => {
      calls.push('upsertSession');
      if (!sessions.has(id)) sessions.set(id, { title: opts.defaultTitle });
    },
    getSession: () => undefined,
    renameSession: () => {},
    deleteSession: () => {},
    listSessions: () => ({ items: [], total: 0 }),
    appendMessage: (
      sessionId: string,
      msg: {
        id: string;
        role: string;
        parts: unknown;
        degraded?: boolean;
        runId?: string;
      },
    ) => {
      calls.push(`appendMessage:${msg.role}`);
      messages.push({ sessionId, ...msg });
    },
    getMessages: () => [],
    close: () => {},
  } as unknown as SessionStore;
  return { store, calls, sessions, messages };
}

function chatRequest(body: ChatRequest): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function bodyWithSession(): ChatRequest {
  return {
    messages: [
      {
        id: 'u1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'hi there' }],
      },
    ],
    sessionId: SESSION_ID,
  };
}

test('§7.1(a): persists the user message BEFORE runChatTurn is invoked', async () => {
  const { store, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => {
    calls.push('runChatTurn');
    return { kind: 'answer', text: 'hi' };
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text(); // drain the SSE body so execute() has fully settled
  expect(calls.indexOf('upsertSession')).toBeLessThan(
    calls.indexOf('runChatTurn'),
  );
  expect(calls.indexOf('appendMessage:user')).toBeLessThan(
    calls.indexOf('runChatTurn'),
  );
});

test('persists the assistant answer AFTER runChatTurn resolves, tagged with degraded + the captured runId (D7)', async () => {
  const { store, messages } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async (input) => {
    input.events({
      type: StatusEventType.RunStart,
      runId: 'run-abc',
      task: input.task,
    });
    input.events({
      type: StatusEventType.Degrade,
      kind: DegradeKind.ModelDegraded,
      subject: 'router',
      reason: 'fallback model used',
    });
    return { kind: 'answer', text: 'the answer' };
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text();

  const assistantRow = messages.find((m) => m.role === ChatRole.Assistant);
  expect(assistantRow).toBeDefined();
  expect(assistantRow?.sessionId).toBe(SESSION_ID);
  expect((assistantRow?.parts as { text: string }[])[0]?.text).toBe(
    'the answer',
  );
  expect(assistantRow?.degraded).toBe(true);
  expect(assistantRow?.runId).toBe('run-abc');
});

test('a "gap" outcome persists result.message as the assistant text (not an empty string)', async () => {
  const { store, messages } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'gap',
    missingCapability: 'video-editing',
    message: "I don't have a capability to handle this yet: video-editing.",
  });
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text();

  const assistantRow = messages.find((m) => m.role === ChatRole.Assistant);
  expect((assistantRow?.parts as { text: string }[])[0]?.text).toBe(
    "I don't have a capability to handle this yet: video-editing.",
  );
  expect(assistantRow?.degraded).toBe(false);
});

test('§7.1(b)/(e): a thrown turn leaves the user row present but writes NO assistant row (deliberate gap, never partial)', async () => {
  const { store, messages, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  // createUIMessageStream's onError converts the throw into an SSE error
  // chunk rather than rejecting handleChat itself (existing behavior).
  await res.text();

  expect(calls).toContain('appendMessage:user');
  expect(messages.some((m) => m.role === ChatRole.Assistant)).toBe(false);
});

test('§7.1(c): a repeat sessionId across two requests upserts once — title from the FIRST request wins', async () => {
  const { store, sessions } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const firstBody: ChatRequest = {
    messages: [
      {
        id: 'u1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'first question' }],
      },
    ],
    sessionId: SESSION_ID,
  };
  const secondBody: ChatRequest = {
    messages: [
      {
        id: 'u2',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'second question' }],
      },
    ],
    sessionId: SESSION_ID,
  };
  await (
    await handleChat(chatRequest(firstBody), { runChatTurn, sessionStore: store })
  ).text();
  await (
    await handleChat(chatRequest(secondBody), {
      runChatTurn,
      sessionStore: store,
    })
  ).text();

  expect(sessions.size).toBe(1);
  expect(sessions.get(SESSION_ID)?.title).toBe('first question');
});

test('a request with no sessionId never touches the session store', async () => {
  const { store, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const body: ChatRequest = {
    messages: [
      { id: 'u1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  };
  await (
    await handleChat(chatRequest(body), { runChatTurn, sessionStore: store })
  ).text();
  expect(calls).toEqual([]);
});

test('a sessionId present but NO sessionStore configured degrades gracefully (no crash, no persistence)', async () => {
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const res = await handleChat(chatRequest(bodyWithSession()), { runChatTurn });
  expect(res.status).toBe(200);
  await res.text();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test tests/server/chat-handler-persistence.test.ts`
Expected: FAIL — `ChatHandlerDeps` has no `sessionStore` field yet (TS error under `bun run typecheck`; the persistence assertions themselves fail under `bun test` since nothing is written to the fake store yet).

- [ ] **Step 5: Replace `src/server/chat/handler.ts` in full**

Read the file first (current content is the 144-line file already on disk from Phase 2/Task 16/17). Replace its ENTIRE contents with:
```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { ChatRole, StatusEventType } from '../../contracts/enums.ts';
import { ChatRequestSchema } from '../../contracts/requests.ts';
import type { StreamSink } from '../../core/agent.ts';
import type { EventSink } from '../../core/events.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import type { SessionStore } from '../../session/store.ts';
import { withUiStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunChatTurn } from './run-turn.ts';
import { buildTaskFromMessages, latestUserMessage, textOf } from './task.ts';

/** `uploadsDir` is optional so existing fakes/tests that never send
 *  `uploadIds` (and so never touch upload-path resolution) don't need to
 *  supply it; the real server (`src/server/main.ts`) always sets it.
 *  `sessionStore` is optional for the identical reason: pre-existing chat
 *  tests that never exercise persistence keep passing untouched, while the
 *  real server always supplies one (Slice 30b Phase 6, D3/D4). */
export type ChatHandlerDeps = {
  runChatTurn: RunChatTurn;
  uploadsDir?: string;
  sessionStore?: SessionStore;
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

/**
 * `POST /api/chat` — parse the request, build the orchestrator `task` from
 * the message history, and stream the turn back as an AI-SDK SSE UI-message
 * stream: `StatusEvent`s become transient `data-*` parts (the enum values
 * ARE the AI-SDK data-part type names) and the orchestrator's own token
 * stream is merged straight through.
 *
 * Turn-boundary persistence (Slice 30b Phase 6, D3/D4/D7, spec §7.1): when
 * `sessionId` + `sessionStore` are both present, the user's ask is upserted
 * and appended HERE, in this function's own synchronous body — well before
 * `createUIMessageStream` (and so before the Response, and any first token,
 * ever exist), which is what satisfies §7.1(a). The assistant's answer
 * persists later, inside `execute`'s `try` block, only once
 * `deps.runChatTurn(...)` has actually resolved — reusing the SAME `result`
 * value the stream-outcome branch already computes, no extra stream tap; a
 * thrown/aborted turn skips straight to `catch`, so the assistant row is
 * simply never written (§7.1(b)/(e) — a deliberate, visible gap, not
 * silent data loss). See `tests/server/chat-handler-persistence.test.ts`
 * for the adversarially-verified requirements (§7.1 a–e).
 */
export async function handleChat(
  req: Request,
  deps: ChatHandlerDeps,
): Promise<Response> {
  let body: ReturnType<typeof ChatRequestSchema.parse>;
  try {
    body = ChatRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid chat request' }, 400);
  }

  const task = buildTaskFromMessages(body.messages);
  const sessionId = body.sessionId;
  const lastUserMsg = latestUserMessage(body.messages);

  // Turn-boundary persistence, part 1 of 2 (D3/D4, §7.1(a)/(c)): the user's
  // ask is durably written BEFORE any engine work starts — this whole block
  // is plain synchronous code in `handleChat`'s own body, not inside
  // `execute`, so nothing below this point can produce output before these
  // calls have returned. `upsertSession`'s `INSERT OR IGNORE` (§7.1(c)) and
  // `appendMessage`'s `INSERT OR IGNORE` on `msg.id` make a retried request
  // for the SAME sessionId/message a safe no-op, never a constraint-
  // violation throw.
  if (sessionId && deps.sessionStore) {
    const startedAt = Date.now();
    deps.sessionStore.upsertSession(sessionId, {
      defaultTitle:
        (lastUserMsg ? textOf(lastUserMsg) : '').slice(0, 80) || 'New chat',
      at: startedAt,
    });
    if (lastUserMsg) {
      deps.sessionStore.appendMessage(
        sessionId,
        { id: lastUserMsg.id, role: lastUserMsg.role, parts: lastUserMsg.parts },
        startedAt,
      );
    }
  }

  // Media-by-reference (Task 16): the browser sends opaque ids minted by a
  // PRIOR `POST /api/upload`, never a raw filesystem path. Resolve each id
  // back to an absolute path through the SAME `confineToDir` primitive the
  // upload endpoint validates its write with — this is the read-side half of
  // that defense-in-depth pair. A bad/escaping id 400s the whole request
  // before any engine work starts (no partial media, no silent drop).
  let media: IngestFlags | undefined;
  if (body.uploadIds && body.uploadIds.length > 0) {
    if (!deps.uploadsDir) {
      return json(
        { error: 'invalid chat request: uploads are not configured' },
        400,
      );
    }
    const images: string[] = [];
    for (const uploadId of body.uploadIds) {
      try {
        images.push(confineToDir(uploadId, deps.uploadsDir));
      } catch (err) {
        if (err instanceof MediaPathError) {
          return json(
            { error: 'invalid chat request: unknown upload id' },
            400,
          );
        }
        throw err;
      }
    }
    media = {
      images,
      audios: [],
      videos: [],
      paste: false,
      voice: false,
      voiceIn: [],
    };
  }

  // The `ui.stream` span MUST wrap the work INSIDE `execute` — not the outer
  // handler body. `createUIMessageStream` does NOT await its `execute`
  // callback, so an outer wrap would return (building the Response) in ~1
  // tick and fire the span's `finally` before the turn ran, recording
  // `{chunks:0, outcome:'unknown'}` for every latency-bearing request. Inside
  // `execute`, the span brackets the awaited `runChatTurn` (which drains the
  // orchestrator stream via `consumeStream()` before resolving), so the
  // span's `finally` records the real outcome + status-event chunk count.
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
        // D7: tapped alongside the existing status-event write below — a
        // Degrade event marks the WHOLE turn degraded (never un-marked by a
        // later event); RunStart's runId is captured the same way so the
        // persisted assistant row can carry it (closes Increment 1's
        // flagged `sessions.run_id`-never-written gap, via T21's extension).
        let degradedThisTurn = false;
        let capturedRunId: string | undefined;
        const events: EventSink = (e) => {
          writer.write({ type: e.type, data: e, transient: true });
          // Best-effort: this counts status-event writes only. The merged
          // orchestrator token stream isn't per-chunk observable here without
          // an extra tap on the ReadableStream passed to `streamSink` — that
          // instrumentation is deferred (documented, not implemented).
          rec.chunk(JSON.stringify(e).length);
          if (e.type === StatusEventType.Degrade) degradedThisTurn = true;
          if (e.type === StatusEventType.RunStart) capturedRunId = e.runId;
        };
        const streamSink: StreamSink = (s) => writer.merge(s);
        try {
          const result = await deps.runChatTurn({
            task,
            media,
            events,
            stream: streamSink,
            signal: req.signal,
          });
          // For 'answer', the text already streamed token-by-token via
          // `streamSink`/`writer.merge` above — nothing more to write. For
          // 'gap'/'resource', the orchestrator only SYNTHESIZES `result.message`
          // AFTER generation finishes (see `runOrchestrator`), so nothing has
          // reached the stream yet; without this, the browser renders an empty
          // assistant bubble (the CLI doesn't have this gap — it prints
          // `result.message` directly). Write it as a one-shot text part.
          const assistantText =
            result.kind === 'answer' ? result.text : result.message;
          if (result.kind !== 'answer') {
            const id = `outcome-${result.kind}`;
            writer.write({ type: 'text-start', id });
            writer.write({ type: 'text-delta', id, delta: assistantText });
            writer.write({ type: 'text-end', id });
          }
          // Turn-boundary persistence, part 2 of 2 (D3/D4/D7, §7.1(b)/(e)):
          // reached ONLY after `runChatTurn` has actually resolved — a throw
          // above (caught below) skips this entirely, so a dropped
          // connection/turn leaves the assistant row simply absent, never
          // partial. The assistant message's id is server-minted: the AI-SDK
          // client mints its own display id independently, so there is no
          // client-generated id available here to reuse (this same id is
          // what Increment 3/T30's `rememberOnce` source string is built
          // from, keeping every turn's auto-ingest dedup key unique).
          const assistantMsgId = `asst-${crypto.randomUUID()}`;
          if (sessionId && deps.sessionStore) {
            deps.sessionStore.appendMessage(
              sessionId,
              {
                id: assistantMsgId,
                role: ChatRole.Assistant,
                parts: [{ type: 'text', text: assistantText }],
                degraded: degradedThisTurn,
                runId: capturedRunId,
              },
              Date.now(),
            );
          }
          rec.outcome(result.kind);
        } catch (err) {
          rec.outcome('error');
          // Re-throw so `createUIMessageStream` emits its own typed error
          // chunk into the stream (no silent drop, no double-handling here).
          throw err;
        }
      });
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

- [ ] **Step 6: Run the new persistence tests to verify they pass**

Run: `bun test tests/server/chat-handler-persistence.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 7: Run the PRE-EXISTING chat-handler suite to confirm zero regression**

Run: `bun test tests/server/chat-handler.test.ts`
Expected: PASS, UNCHANGED — every pre-existing test constructs `{runChatTurn: fake}` with no `sessionStore`, which the new optional field accommodates exactly like `uploadsDir` already does.

- [ ] **Step 8: Full server suite regression**

Run: `bun test tests/server/`
Expected: PASS.

- [ ] **Step 9: ultracode adversarial-verify (see the task header banner) — do NOT skip**

Dispatch an Opus-powered Workflow-tool adversarial-verify pass against this task's diff (`src/server/chat/handler.ts`, `src/server/chat/task.ts`, `tests/server/chat-handler-persistence.test.ts`). The reviewer must explicitly confirm requirements (a)–(e) from this task's header banner, not merely "tests are green" — in particular (b)/(e) requires reasoning about the `try`/`catch` control flow (is there ANY path where the assistant row could be written partially, or where an error is swallowed silently instead of surfacing?) and (d) requires confirming `crypto.randomUUID()` is called fresh on every turn (never hoisted/cached across turns). Record the verdict + any fixes in the SDD ledger per this repo's standing process.

- [ ] **Step 10: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/chat/handler.ts src/server/chat/task.ts tests/server/chat-handler-persistence.test.ts
git add src/server/chat/handler.ts src/server/chat/task.ts tests/server/chat-handler-persistence.test.ts
git commit -m "feat(server): wire turn-boundary session persistence into handleChat (Phase 6 Incr 2, D3/D4/D7, spec §7.1)"
```

---

## Task T27 [web — vitest]: `ChatArea` mints/persists/threads/rehydrates the session id

**Files:**
- Modify: `web/src/features/chat/index.tsx` (full-file replacement below)
- Modify: `web/src/features/chat/index.test.tsx` (one assertion updated — the plain-text send now threads a body)
- Modify: `web/src/features/chat/actions.test.tsx` (one assertion updated — the edit+resend send now threads a body)
- Modify: `web/src/features/chat/attachments.test.tsx` (two assertions updated — every send now carries `sessionId`, so the "no empty body override" test's premise changes to "still no `uploadIds` key, but sessionId is always present")
- Test: `web/src/features/chat/session.test.tsx` (create)

**Interfaces:**
- Consumes: `SessionDtoSchema`/`SessionDTO` (`@contracts`, already landed Increment 1); `apiFetch` (`web/src/shared/contract/client.ts`, unchanged).
- Produces: every `sendMessage` call now threads `{ body: { sessionId, ...(uploadIds.length > 0 ? { uploadIds } : {}) } }` — `sessionId` is client-minted via `crypto.randomUUID()` on the first send of a brand-new chat (or adopted from a rehydrated one), persisted to `localStorage['agent.activeSessionId']`, and reused for every later send in the same mounted chat. On mount, a stored id triggers one `GET /api/sessions/:id` fetch that rehydrates `messages` via `setMessages`; a failed/404'd fetch clears the stored id instead of repeatedly failing.

**Design note — why 4 test files change, not 1:** every pre-existing test that asserts `sendMessage`'s exact call args in the PLAIN-text-send path (no attachment) hard-coded the assumption "no body override at all" (see `attachments.test.tsx`'s own test title, `'... (regression: no empty body override)'`). This plan's design REQUIRES a body override on every send now (D2 — `sessionId` must thread through), so that invariant is a deliberate, documented behavior change, not a regression to paper over — each affected assertion is updated to expect `{ body: { sessionId: expect.any(String) } }` instead of no second argument.

- [ ] **Step 1: Update `web/src/features/chat/index.test.tsx`'s send-args assertion**

Read the file first (33-line-ish `beforeEach`, then the affected test at lines ~49–56). Replace:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    mockMessages = [];
  });
```
with:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    mockMessages = [];
    localStorage.clear();
  });
```
and replace:
```typescript
  it('submits typed text via sendMessage and clears the input', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(sendMessage).toHaveBeenCalledWith({ text: 'ping' });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });
```
with:
```typescript
  it('submits typed text via sendMessage (threading a freshly-minted sessionId) and clears the input', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    // Slice 30b Phase 6 (D2): every send threads a body.sessionId now —
    // minted fresh here since this test never rehydrates a stored one.
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'ping' },
      { body: { sessionId: expect.any(String) } },
    );
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });
```

- [ ] **Step 2: Update `web/src/features/chat/actions.test.tsx`'s edit+resend assertion**

Read the file first. Replace:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    stop.mockClear();
    regenerate.mockClear();
    setMessages.mockClear();
    mockStatus = 'ready';
    mockMessages = [];

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
```
with:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    stop.mockClear();
    regenerate.mockClear();
    setMessages.mockClear();
    mockStatus = 'ready';
    mockMessages = [];
    localStorage.clear();

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
```
and replace:
```typescript
    expect(setMessages).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: awaited call is guaranteed present
    const updater = setMessages.mock.calls[0]![0] as (
      msgs: MockMessage[],
    ) => MockMessage[];
    // Truncates to BEFORE the edited user message (index 0) — drops it and
    // everything after, since the edited text is resent as a fresh turn.
    expect(updater(mockMessages)).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith({ text: 'edited question' });
  });
```
with:
```typescript
    expect(setMessages).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: awaited call is guaranteed present
    const updater = setMessages.mock.calls[0]![0] as (
      msgs: MockMessage[],
    ) => MockMessage[];
    // Truncates to BEFORE the edited user message (index 0) — drops it and
    // everything after, since the edited text is resent as a fresh turn.
    expect(updater(mockMessages)).toEqual([]);
    // Slice 30b Phase 6 (D2): every send threads a body.sessionId, edit+resend included.
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'edited question' },
      { body: { sessionId: expect.any(String) } },
    );
  });
```

- [ ] **Step 3: Update `web/src/features/chat/attachments.test.tsx`'s two send-args assertions**

Read the file first. Replace the `beforeEach` inside `describe('Composer drag-drop / paste-image attachments', ...)`:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ uploadId: 'dropped-abc123.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });
```
with:
```typescript
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ uploadId: 'dropped-abc123.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });
```
Replace:
```typescript
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        { text: 'look at this' },
        { body: { uploadIds: ['dropped-abc123.png'] } },
      ),
    );
    expect(screen.queryByText('cat.png')).not.toBeInTheDocument();
  });

  it('a plain text send with no attachment calls sendMessage with just { text } (regression: no empty body override)', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'no image here' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ text: 'no image here' }),
    );
  });
});
```
with:
```typescript
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        { text: 'look at this' },
        {
          body: {
            uploadIds: ['dropped-abc123.png'],
            sessionId: expect.any(String),
          },
        },
      ),
    );
    expect(screen.queryByText('cat.png')).not.toBeInTheDocument();
  });

  it('a plain text send with no attachment carries sessionId but no uploadIds key (Slice 30b Phase 6: sessionId always threads; uploadIds is attachment-only)', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'no image here' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        { text: 'no image here' },
        { body: { sessionId: expect.any(String) } },
      ),
    );
  });
});
```

- [ ] **Step 4: Run all four (soon-to-be-)failing test files to verify the expected failures**

Run: `cd web && bun run test -- chat/index.test.tsx chat/actions.test.tsx chat/attachments.test.tsx`
Expected: FAIL — every updated assertion fails against the CURRENT `index.tsx` (which still calls `sendMessage({text})`/`sendMessage({text},{body:{uploadIds}})` with no `sessionId`); `session.test.tsx` doesn't exist yet so it isn't picked up (create it in Step 6).

- [ ] **Step 5: Write the new session-wiring tests**

`web/src/features/chat/session.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

const SESSION_KEY = 'agent.activeSessionId';

type MockStatus = 'ready' | 'streaming' | 'submitted' | 'error';

const sendMessage = vi.fn();
const setMessages = vi.fn();
let mockStatus: MockStatus = 'ready';

// Same rationale as index.test.tsx/actions.test.tsx: mock the hook itself
// rather than the SSE wire format, and drive its return shape directly.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: mockStatus,
    stop: vi.fn(),
    regenerate: vi.fn(),
    setMessages,
  }),
}));

describe('ChatArea session id (Slice 30b Phase 6, D2)', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    setMessages.mockClear();
    mockStatus = 'ready';
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a v4 UUID sessionId on the first send of a new chat and persists it to localStorage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, opts] = sendMessage.mock.calls[0] as [
      unknown,
      { body: { sessionId: string } },
    ];
    expect(opts.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(localStorage.getItem(SESSION_KEY)).toBe(opts.body.sessionId);
  });

  it('reuses the SAME sessionId across two sends in one mounted chat (does not re-mint)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);

    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const first = (
      sendMessage.mock.calls[0] as [unknown, { body: { sessionId: string } }]
    )[1];
    const second = (
      sendMessage.mock.calls[1] as [unknown, { body: { sessionId: string } }]
    )[1];
    expect(second.body.sessionId).toBe(first.body.sessionId);
  });

  it('rehydrates a stored sessionId on mount: GETs /api/sessions/:id and calls setMessages with the mapped transcript', async () => {
    const storedId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, storedId);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: storedId,
          title: 'Old chat',
          owner: 'local',
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: 'm1', role: 'user', text: 'hello' },
            { id: 'm2', role: 'assistant', text: 'hi there' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');

    await waitFor(() => expect(setMessages).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/sessions/${storedId}`);
    const rehydrated = setMessages.mock.calls[0]?.[0] as {
      id: string;
      role: string;
      parts: { type: string; text: string }[];
    }[];
    expect(rehydrated).toEqual([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hi there' }],
      },
    ]);
  });

  it('does nothing on mount when localStorage has no stored sessionId', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    await screen.findByTestId('area-chat');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('a stale/deleted stored sessionId (404) clears localStorage instead of crashing', async () => {
    localStorage.setItem(SESSION_KEY, 'stale-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );
    renderAt('/');
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
  });
});
```

- [ ] **Step 6: Replace `web/src/features/chat/index.tsx` in full**

Read the file first (current content is the 123-line file already on disk from Phase 2). Replace its ENTIRE contents with:
```tsx
import { useChat } from '@ai-sdk/react';
import type { FeedbackRating } from '@contracts';
import { SessionDtoSchema } from '@contracts';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch, sessionToken } from '../../shared/contract/client.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { LiveRail } from '../agents/live-rail.tsx';
import { useStatusEvents } from '../agents/use-status-events.ts';
import { Composer } from './composer.tsx';
import { ConfirmPrompt } from './confirm-prompt.tsx';
import { MessageList } from './message-list.tsx';

/** Join a message's text parts into the single string clipboard/resend need. */
function joinedText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** A user message being edited: its index (truncation point) + prefill text. */
type EditDraft = { index: number; text: string };

/** Persists the active chat's client-minted session id across reloads (Slice
 *  30b Phase 6, D2): minted once via `crypto.randomUUID()` on the first send
 *  of a new chat, then reused for every later turn in that chat; on a fresh
 *  mount, a stored id triggers a rehydrate fetch instead of a fresh mint. */
const SESSION_STORAGE_KEY = 'agent.activeSessionId';

export function ChatArea() {
  const { view, handleData, pendingConfirm, runId, clearConfirm } =
    useStatusEvents();
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const { messages, sendMessage, status, stop, regenerate, setMessages } =
    useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
      }),
      onData: handleData,
    });
  const [editDraft, setEditDraft] = useState<EditDraft | undefined>(undefined);

  const isBusy = status === 'streaming' || status === 'submitted';

  // Rehydrate a previously-active session on mount (D2): a stored id both
  // becomes the active sessionId (so the next send threads the SAME id, not
  // a fresh mint) and triggers a one-shot transcript fetch. A stale/deleted
  // id (404, or any other fetch/parse failure) clears the stored id rather
  // than repeatedly failing on every later send.
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;
    setSessionId(stored);
    apiFetch(`/sessions/${stored}`, { schema: SessionDtoSchema })
      .then((session) => {
        setMessages(
          session.messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            parts: [{ type: 'text' as const, text: m.text }],
          })),
        );
      })
      .catch(() => {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setSessionId(undefined);
      });
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
    // one-time mount effect (rehydrate) — not a live sync on every render.
  }, []);

  function handleSend(text: string, uploadIds: string[]) {
    if (editDraft) {
      // Edit+resend: drop the edited message and everything after it, then
      // resend the edited text as a fresh turn.
      setMessages((msgs) => msgs.slice(0, editDraft.index));
      setEditDraft(undefined);
    }
    // Mint a session id on the FIRST send of a brand-new chat (D2); once
    // minted (or rehydrated above) it's reused for every later turn.
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      activeSessionId = crypto.randomUUID();
      setSessionId(activeSessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
    }
    const body: { sessionId: string; uploadIds?: string[] } = {
      sessionId: activeSessionId,
    };
    if (uploadIds.length > 0) body.uploadIds = uploadIds;
    sendMessage({ text }, { body });
  }

  function handleCopy(message: UIMessage) {
    navigator.clipboard.writeText(joinedText(message));
  }

  function handleEdit(message: UIMessage) {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index === -1) return;
    setEditDraft({ index, text: joinedText(message) });
  }

  async function handleFeedback(messageId: string, rating: FeedbackRating) {
    await apiFetch('/feedback', {
      method: 'POST',
      body: { messageId, rating },
      schema: z.object({ ok: z.boolean() }),
    });
  }

  async function handleConfirmAnswer(value: boolean) {
    if (!pendingConfirm) return;
    // A Confirm without a prior RunStart has no run to answer to; don't POST
    // to `/api/runs//respond`. Just clear it locally — the prompt is simply
    // left unanswered (no consumer awaits it this phase; the consent channel is
    // a dormant seam, so there is nothing to decline server-side).
    if (!runId) {
      clearConfirm();
      return;
    }
    await createSseTransport().respond(runId, {
      promptId: pendingConfirm.promptId,
      value,
    });
    clearConfirm();
  }

  return (
    <RegionErrorBoundary region="Chat">
      <section data-testid="area-chat" className="flex h-full flex-col">
        <LiveRail view={view} />
        <MessageList
          messages={messages}
          onCopy={handleCopy}
          onRegenerate={(messageId) => regenerate({ messageId })}
          onEdit={handleEdit}
          onFeedback={handleFeedback}
        />
        {pendingConfirm && (
          <ConfirmPrompt ask={pendingConfirm} onAnswer={handleConfirmAnswer} />
        )}
        {isBusy && (
          <div className="flex justify-center border-t border-[var(--color-border)] p-2">
            <Button onClick={() => stop()}>Stop</Button>
          </div>
        )}
        <Composer
          key={editDraft ? editDraft.index : 'compose'}
          initialValue={editDraft?.text ?? ''}
          onSend={handleSend}
          disabled={status !== 'ready'}
        />
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 7: Run the whole chat feature's vitest suite to verify everything passes**

Run: `cd web && bun run test -- chat/`
Expected: PASS — `index.test.tsx`, `actions.test.tsx`, `attachments.test.tsx`, `confirm-prompt.test.tsx`, and the new `session.test.tsx` all green.

- [ ] **Step 8: Web typecheck**

Run: `cd web && bun run typecheck`
Expected: clean (0 errors) — in particular, `SessionDtoSchema`'s inferred `SessionDTO` type must actually be importable from `@contracts` (confirm the `@contracts` alias resolves to `src/contracts` and that `index.ts`'s wildcard re-export surfaces it, both already true per Increment 1).

- [ ] **Step 9: Full web suite regression**

Run: `cd web && bun run test`
Expected: PASS.

- [ ] **Step 10: Gate + commit**

```bash
bun run lint:file -- web/src/features/chat/index.tsx web/src/features/chat/index.test.tsx web/src/features/chat/actions.test.tsx web/src/features/chat/attachments.test.tsx web/src/features/chat/session.test.tsx
git add web/src/features/chat/index.tsx web/src/features/chat/index.test.tsx web/src/features/chat/actions.test.tsx web/src/features/chat/attachments.test.tsx web/src/features/chat/session.test.tsx
git commit -m "feat(web): ChatArea mints/persists/threads/rehydrates the chat sessionId (Phase 6 Incr 2, D2)"
```

---

# Increment 3 — Recall + auto-ingest (spec §5 item 3, D5/D6)

Increment 2 (T20–T27) is now complete: chat turns persist durably, keyed by a client-minted, format-validated `sessionId`. Increment 3 gives chat its first real memory-recall caller — `injectRecall` (built in an earlier slice, never called until now) — and closes the loop by having every completed server turn fire-and-forget auto-ingest itself into a dedicated `chat` memory space, so a LATER session can recall an EARLIER one. Per D5, the READ half (`injectRecall`) is engine-level and shared by CLI+server (via `ChatSessionDeps`/`runChatSession`); the WRITE half (`rememberOnce` auto-ingest) is server-only, since only the server's chat-persistence layer has a `sessionId` to namespace by.

## Task T28: `MemoryStore.rememberOnce` (D6) + a new `memory.remember` span

**Files:**
- Modify: `src/telemetry/spans.ts` (add one `ATTR` entry + one new span helper, `withMemoryRememberSpan`)
- Modify: `src/memory/store.ts` (add `rememberOnce` to the returned closure)
- Test: `tests/memory/remember-once.test.ts` (create)

**Interfaces:**
- Consumes: `createHash` (`node:crypto`, already imported in `store.ts`); `sql.seenDoc`/`sql.recordDoc` (`SqliteStore`, unchanged — the SAME dedup primitive `ingest()` already uses, keyed on `(space, source)` + a content hash); `ensureSpace`/`writeChunks` (private helpers already in `store.ts`, unchanged); `MemoryKind.RunMemory` (`src/memory/types.ts`, unchanged).
- Produces: `MemoryStore.rememberOnce(text: string, o: { space?: string; namespace?: string; source: string; at: number }): Promise<{ skipped: boolean }>` — deduplicates on `sha256(text)` keyed by `(space, source)`, exactly like `ingest()` but for raw text (no file/path). A new span, `memory.remember` (attrs: `space`, `namespace`, `skipped`) — **wraps the WHOLE call including the dedup check**, deliberately DIFFERENT from `ingest()`'s "check-then-span" ordering (where a dedup-skip never appears in the trace at all): chat callers never pre-check `seenDoc` themselves, so this span is what makes "how often does chat auto-ingest dedup-skip" answerable straight from traces.

- [ ] **Step 1: Write the failing span-helper test**

`tests/memory/spans-remember.test.ts` (create — kept separate from the store-level test so the span contract itself is proven in isolation, matching `tests/memory/spans.test.ts`'s existing precedent for `withMemoryRecallSpan`):
```typescript
import { describe, expect, test } from 'bun:test';
import { ATTR, withMemoryRememberSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

describe('withMemoryRememberSpan', () => {
  test('records space + namespace + skipped', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan(
      { space: 'chat', namespace: 'sess-1' },
      async () => ({ skipped: false }),
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.MEMORY_SPACE]).toBe('chat');
    expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBe('sess-1');
    expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(false);
  });

  test('records skipped:true when the wrapped call reports a dedup-skip', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan({ space: 'chat' }, async () => ({
      skipped: true,
    }));
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(true);
  });

  test('omits the namespace attribute when none is given', async () => {
    const { exporter } = registerTestProvider();
    await withMemoryRememberSpan({ space: 'chat' }, async () => ({
      skipped: false,
    }));
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'memory.remember');
    expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/memory/spans-remember.test.ts`
Expected: FAIL — `withMemoryRememberSpan`/`ATTR.MEMORY_REMEMBER_SKIPPED` don't exist yet (module resolution / undefined-export error).

- [ ] **Step 3: Add the `ATTR` entry and `withMemoryRememberSpan` to `src/telemetry/spans.ts`**

Replace:
```typescript
  MEMORY_RERANKED: 'memory.reranked',
  MEMORY_EMBED_MODEL: 'memory.embed_model',
```
with:
```typescript
  MEMORY_RERANKED: 'memory.reranked',
  MEMORY_EMBED_MODEL: 'memory.embed_model',
  /** Slice 30b Phase 6 (D6) — whether a `rememberOnce` auto-ingest call was
   *  a dedup no-op. */
  MEMORY_REMEMBER_SKIPPED: 'memory.remember.skipped',
```

Add this new export immediately after the existing `withMemoryIngestSpan` function (right before `export type MemoryEmbedInfo`):
```typescript
export type MemoryRememberInfo = { space: string; namespace?: string };

/** Span for one `rememberOnce` auto-ingest call (Slice 30b Phase 6, D6):
 *  unlike `withMemoryIngestSpan` (whose caller checks `seenDoc` BEFORE
 *  opening the span, so a dedup-skip never appears in the trace at all),
 *  this span wraps the WHOLE call including the dedup check — the
 *  `skipped` attribute is what makes "how often does chat auto-ingest
 *  dedup-skip" answerable straight from spans, since chat callers never
 *  pre-check `seenDoc` themselves. */
export function withMemoryRememberSpan<T extends { skipped: boolean }>(
  info: MemoryRememberInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.remember', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    if (info.namespace) {
      span.setAttribute(ATTR.MEMORY_NAMESPACE, info.namespace);
    }
    const result = await fn();
    span.setAttribute(ATTR.MEMORY_REMEMBER_SKIPPED, result.skipped);
    return result;
  });
}
```

- [ ] **Step 4: Run the span test to verify it passes**

Run: `bun test tests/memory/spans-remember.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Write the failing `rememberOnce` tests**

`tests/memory/remember-once.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const DIR = '/tmp/memstore-rememberonce-test';

function fakeDeps() {
  const vec = (t: string) => [t.charCodeAt(0) || 0, 1];
  return {
    embedTexts: async (ts: string[]) => ts.map(vec),
    embedQuery: async (t: string) => vec(t),
    probe: async () => ({ dim: 2, maxInput: 2048 }),
  };
}

describe('MemoryStore.rememberOnce (Slice 30b Phase 6, D6)', () => {
  test('writes a chunk and returns skipped:false on the first call', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      const result = await store.rememberOnce('hello world', {
        space: 'chat',
        namespace: 'sess-1',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      expect(result.skipped).toBe(false);
      const stats = await store.stats();
      expect(stats.chat).toBe(1);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('a repeat call with the SAME source+text is deduped (skipped:true, no new chunk)', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('hello world', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('hello world', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 2,
      });
      expect(second.skipped).toBe(true);
      const stats = await store.stats();
      expect(stats.chat).toBe(1); // no second chunk written
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('the SAME source with DIFFERENT text is NOT deduped (hash+source, not source alone)', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('first text', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('different text', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 2,
      });
      expect(second.skipped).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('§7.1(d): a DIFFERENT source (a different turn) is never deduped against a prior turn', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('same text both turns', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('same text both turns', {
        space: 'chat',
        source: 'chat:sess-1:m2',
        at: 2,
      });
      expect(second.skipped).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('emits a memory.remember span tagged with space/namespace/skipped', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const { exporter } = registerTestProvider();
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('hello world', {
        space: 'chat',
        namespace: 'sess-1',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'memory.remember');
      expect(span).toBeDefined();
      expect(span?.attributes[ATTR.MEMORY_SPACE]).toBe('chat');
      expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBe('sess-1');
      expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test tests/memory/remember-once.test.ts`
Expected: FAIL — `store.rememberOnce` is not a function yet.

- [ ] **Step 7: Add `rememberOnce` to `src/memory/store.ts`**

Read the file first. Change the import line:
```typescript
import { withMemoryIngestSpan } from '../telemetry/spans.ts';
```
to:
```typescript
import { withMemoryIngestSpan, withMemoryRememberSpan } from '../telemetry/spans.ts';
```

Add this method to the returned object, immediately after the existing `async ingest(...)` method and before `async recall(...)`:
```typescript
    async rememberOnce(
      text: string,
      o: { space?: string; namespace?: string; source: string; at: number },
    ): Promise<{ skipped: boolean }> {
      const space = o.space ?? DEFAULT_SPACE;
      return withMemoryRememberSpan(
        { space, namespace: o.namespace },
        async () => {
          const hash = createHash('sha256').update(text).digest('hex');
          if (sql.seenDoc(space, o.source, hash)) return { skipped: true };
          const meta = await ensureSpace(space, o.at);
          const n = await writeChunks(
            meta,
            o.namespace ?? '',
            MemoryKind.RunMemory,
            o.source,
            text,
            o.at,
          );
          sql.recordDoc(space, o.source, hash, n, o.at);
          return { skipped: false };
        },
      );
    },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/memory/remember-once.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 9: Full memory-suite regression**

Run: `bun test tests/memory/`
Expected: PASS — `rememberOnce` is purely additive (new method, new span helper, no existing method's behavior changed).

- [ ] **Step 10: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/telemetry/spans.ts src/memory/store.ts tests/memory/spans-remember.test.ts tests/memory/remember-once.test.ts
git add src/telemetry/spans.ts src/memory/store.ts tests/memory/spans-remember.test.ts tests/memory/remember-once.test.ts
git commit -m "feat(memory): add MemoryStore.rememberOnce + memory.remember span (Phase 6 Incr 3, D6)"
```

---

## Task T29: `ChatSessionDeps.memoryStore` + `injectRecall` wiring in `runChatSession` (D5, CLI+server shared seam)

**Files:**
- Modify: `src/cli/run-chat-session.ts` (add `CHAT_MEMORY_SPACE` export, `memoryStore?` field, the `injectRecall` call)
- Modify: `tests/cli/run-chat-session.test.ts` (append tests)

**Interfaces:**
- Consumes: `injectRecall` (`src/memory/recall-tool.ts`, already built, previously never called — signature `injectRecall(store: MemoryStore, ctx: {space?, namespace?}, task: string): Promise<string>`, unchanged); `MemoryStore` type (`src/memory/store.ts`).
- Produces: `export const CHAT_MEMORY_SPACE = 'chat';` — the single source of truth both `runChatSession` (this task, READ) and `handleChat` (T30, WRITE via `rememberOnce`) import, so the space string can never drift between the two. `ChatSessionDeps.memoryStore?: MemoryStore` — optional, so every pre-existing `ChatSessionDeps` fixture in `tests/cli/run-chat-session.test.ts`/`tests/server/*.test.ts` that never sets it keeps passing unmodified (same optional-field precedent as `ledger`/`routerNumCtx`/`runChatImpl` already established on this same type). When present, `runChatSession` calls `injectRecall(deps.memoryStore, {space: CHAT_MEMORY_SPACE}, task)` immediately after the existing media-ingest block resolves (recall is space-wide, no `namespace` filter — the whole point of "recall across every prior session," per D5/the spec's locked scope).

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/run-chat-session.test.ts` (add the two new imports to the top-of-file import list, then append two new `it` blocks inside the existing `describe('runChatSession', ...)`, right after the `'never touches console.log or console.error'` test and before the D17 auto-detect tests):

Add to the imports:
```typescript
import {
  CHAT_MEMORY_SPACE,
  type ChatSessionDeps,
  runChatSession,
} from '../../src/cli/run-chat-session.ts';
```
(replacing the existing, narrower `import { type ChatSessionDeps, runChatSession } from '../../src/cli/run-chat-session.ts';` line) and add:
```typescript
import type { MemoryStore } from '../../src/memory/store.ts';
```

Append these two tests:
```typescript
  it('with no memoryStore configured, the task is unchanged (existing behavior, no recall)', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const result = await runChatSession({
      task: 'what did we discuss last time?',
      deps: fakeDeps({ runChatImpl: async () => scripted }),
    });
    expect(result.task).toBe('what did we discuss last time?');
  });

  it('with a memoryStore configured, injectRecall prepends recalled context to the task (space="chat")', async () => {
    const scripted: OrchestratorResult = { kind: 'answer', text: 'hi' };
    const recallCalls: { query: string; opts: { space?: string } }[] = [];
    const fakeMemoryStore = {
      recall: async (query: string, opts: { space?: string }) => {
        recallCalls.push({ query, opts });
        return [
          {
            id: 'd#0',
            source: 'chat:sess-1:m1',
            text: 'we discussed cats',
            score: 1,
            namespace: '',
          },
        ];
      },
    } as unknown as MemoryStore;
    const result = await runChatSession({
      task: 'what did we discuss last time?',
      deps: fakeDeps({
        runChatImpl: async () => scripted,
        memoryStore: fakeMemoryStore,
      }),
    });
    expect(result.task).toContain('we discussed cats');
    expect(result.task).toContain('what did we discuss last time?');
    expect(recallCalls).toHaveLength(1);
    expect(recallCalls[0]?.opts.space).toBe('chat');
  });

  it('CHAT_MEMORY_SPACE is the literal "chat" (the single source of truth handler.ts must match, T30)', () => {
    expect(CHAT_MEMORY_SPACE).toBe('chat');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/cli/run-chat-session.test.ts`
Expected: FAIL — `CHAT_MEMORY_SPACE` is not exported yet, and `ChatSessionDeps` has no `memoryStore` field (compile error via `bun run typecheck`; the recall test also fails at runtime since the task is never touched today).

- [ ] **Step 3: Wire `injectRecall` into `src/cli/run-chat-session.ts`**

Read the file first (current content is the 105-line file already on disk). Add these two imports (alongside the existing ones, in the same relative-path-alphabetical grouping):
```typescript
import { injectRecall } from '../memory/recall-tool.ts';
import type { MemoryStore } from '../memory/store.ts';
```

Add the exported constant right after the imports, before `export type ChatSessionDeps`:
```typescript
/** The dedicated memory space every chat turn recalls from and auto-ingests
 *  into (Slice 30b Phase 6, D5/D6). The single source of truth — `handler.ts`
 *  (T30) imports this SAME constant for its `rememberOnce` auto-ingest call
 *  so the two can never drift apart. */
export const CHAT_MEMORY_SPACE = 'chat';
```

Add one field to `ChatSessionDeps` (right after the existing `runChatImpl?` field):
```typescript
  /** Optional (Slice 30b Phase 6, D5): when present, `runChatSession` prepends
   *  recalled context from the shared `chat` memory space before running the
   *  orchestrator. CLI (`src/cli/chat.ts`, T31) wires it for the READ benefit
   *  only; the server (`src/server/chat/run-turn.ts`, T30) wires it for both
   *  read (here) and write (`handleChat`'s `rememberOnce` auto-ingest). */
  memoryStore?: MemoryStore;
```

Insert the recall call immediately after the existing media-ingest block (right after `warnings.push(...ingested.warnings);` and its closing `}`, before `const orchestrator = createSuperAgent(...)`):
```typescript
  if (deps.memoryStore) {
    task = await injectRecall(deps.memoryStore, { space: CHAT_MEMORY_SPACE }, task);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/cli/run-chat-session.test.ts`
Expected: PASS (all pre-existing tests + 3 new = every test in the file).

- [ ] **Step 5: Full CLI-suite regression**

Run: `bun test tests/cli/`
Expected: PASS — `memoryStore` is a new OPTIONAL field; no pre-existing `ChatSessionDeps` fixture sets it, so `runChatSession`'s new `if (deps.memoryStore)` branch is simply never taken by any pre-existing test.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/cli/run-chat-session.ts tests/cli/run-chat-session.test.ts
git add src/cli/run-chat-session.ts tests/cli/run-chat-session.test.ts
git commit -m "feat(cli): wire injectRecall into runChatSession via optional memoryStore (Phase 6 Incr 3, D5)"
```

---

## Task T30: Server threads `memoryStore` into the chat engine seam + `handler.ts` fires fire-and-forget auto-ingest

**Files:**
- Modify: `src/server/chat/run-turn.ts` (`createRealRunChatTurn` gains a `memoryStore?: MemoryStore` param, threaded into `runChatSession`'s `deps`)
- Modify: `src/server/main.ts` (reorder so `memoryStore` is constructed BEFORE `runChatTurn`; pass it into `createRealRunChatTurn`)
- Modify: `src/server/chat/handler.ts` (full-file replacement below — `ChatHandlerDeps.memoryStore?: MemoryStore`; the fire-and-forget `rememberOnce` call after the assistant persist)
- Test: `tests/server/chat-handler-auto-ingest.test.ts` (create)

**Interfaces:**
- Consumes: `CHAT_MEMORY_SPACE` (T29, `src/cli/run-chat-session.ts` — the SAME exported constant, imported here so the space string can never drift); `MemoryStore.rememberOnce` (T28).
- Produces: `createRealRunChatTurn(engine: LazyEngine, memoryStore?: MemoryStore): RunChatTurn` — the ONE construction-time dependency added to this factory (not a per-request input; `RunChatTurn`'s own call-shape type is UNCHANGED, since `memoryStore` is captured in closure, exactly like `engine` already is). `ChatHandlerDeps.memoryStore?: MemoryStore` — optional, same precedent as `sessionStore`; when a `sessionId` and `memoryStore` are both present, `handleChat` fires `void deps.memoryStore.rememberOnce(...)` (NEVER awaited — the SSE response must be free to end without waiting on an embedding round-trip) immediately after the (awaited) assistant persist, with `source: \`chat:${sessionId}:${assistantMsgId}\`` reusing the SAME server-minted `assistantMsgId` T26 already computes.

**Design note — why `memoryStore` genuinely needs threading through `RunChatTurn`, unlike `sessionStore` (T26):** `injectRecall` (T29) runs one layer deeper than `handleChat` — inside `runChatSession`, the CLI/server-shared engine seam reached via `createRealRunChatTurn`. `sessionStore`'s persistence, by contrast, lives entirely in `handleChat` itself, which is why T26 needed no `RunChatTurn`/`createRealRunChatTurn` signature change. `memoryStore`'s WRITE half (`rememberOnce` auto-ingest), however, DOES live in `handleChat` (server-only per D5, since only the server's chat-persistence layer has a `sessionId` to namespace by) — so `ChatHandlerDeps` also gains its own separate `memoryStore?` field, used only for the fire-and-forget write, distinct from (but backed by the SAME real `MemoryStore` instance as) the one threaded into `createRealRunChatTurn` for the read.

- [ ] **Step 1: Write the failing auto-ingest tests**

`tests/server/chat-handler-auto-ingest.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { CHAT_MEMORY_SPACE } from '../../src/cli/run-chat-session.ts';
import { ChatRole } from '../../src/contracts/enums.ts';
import type { ChatRequest } from '../../src/contracts/requests.ts';
import type { MemoryStore } from '../../src/memory/store.ts';
import { handleChat } from '../../src/server/chat/handler.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';

const SESSION_ID = crypto.randomUUID();

function chatRequest(body: ChatRequest): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function bodyWithSession(): ChatRequest {
  return {
    messages: [
      {
        id: 'u1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'hi there' }],
      },
    ],
    sessionId: SESSION_ID,
  };
}

test('auto-ingest is fired-and-forgotten: rememberOnce is called but never awaited (the stream ends before it resolves)', async () => {
  let rememberCalled = false;
  let rememberResolved = false;
  const fakeMemoryStore = {
    rememberOnce: async () => {
      rememberCalled = true;
      await new Promise((r) => setTimeout(r, 30));
      rememberResolved = true;
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'answer',
    text: 'the answer',
  });

  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    memoryStore: fakeMemoryStore,
  });
  await res.text(); // the stream fully drains/ends here

  expect(rememberCalled).toBe(true);
  // The key assertion: the stream has already ended, but rememberOnce's own
  // internal 30ms delay hasn't resolved yet — proving handleChat never
  // awaited it (D5/D6, spec §7.1's fire-and-forget requirement).
  expect(rememberResolved).toBe(false);
});

test('calls rememberOnce with the chat space, sessionId namespace, and a per-turn-unique source built from the SAME assistant id T26 persists', async () => {
  const calls: {
    text: string;
    opts: { space: string; namespace?: string; source: string };
  }[] = [];
  const fakeMemoryStore = {
    rememberOnce: async (
      text: string,
      opts: { space: string; namespace?: string; source: string },
    ) => {
      calls.push({ text, opts });
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'answer',
    text: 'the answer',
  });

  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    memoryStore: fakeMemoryStore,
  });
  await res.text();

  expect(calls).toHaveLength(1);
  expect(calls[0]?.opts.space).toBe(CHAT_MEMORY_SPACE);
  expect(calls[0]?.opts.namespace).toBe(SESSION_ID);
  expect(calls[0]?.opts.source).toMatch(
    new RegExp(`^chat:${SESSION_ID}:asst-`),
  );
  expect(calls[0]?.text).toContain('hi there');
  expect(calls[0]?.text).toContain('the answer');
});

test('a request with no sessionId never touches memoryStore (no namespace to auto-ingest under)', async () => {
  let called = false;
  const fakeMemoryStore = {
    rememberOnce: async () => {
      called = true;
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const body: ChatRequest = {
    messages: [
      { id: 'u1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  };
  await (
    await handleChat(chatRequest(body), { runChatTurn, memoryStore: fakeMemoryStore })
  ).text();
  expect(called).toBe(false);
});

test('a sessionId present but no memoryStore configured degrades gracefully (no crash, no auto-ingest)', async () => {
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const res = await handleChat(chatRequest(bodyWithSession()), { runChatTurn });
  expect(res.status).toBe(200);
  await res.text();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/server/chat-handler-auto-ingest.test.ts`
Expected: FAIL — `ChatHandlerDeps` has no `memoryStore` field yet.

- [ ] **Step 3: Replace `src/server/chat/handler.ts` in full (extends T26's version with the auto-ingest fire)**

Read the file first (T26 landed the 220-ish-line version). Replace its ENTIRE contents with:
```typescript
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { CHAT_MEMORY_SPACE } from '../../cli/run-chat-session.ts';
import { ChatRole, StatusEventType } from '../../contracts/enums.ts';
import { ChatRequestSchema } from '../../contracts/requests.ts';
import type { StreamSink } from '../../core/agent.ts';
import type { EventSink } from '../../core/events.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import type { MemoryStore } from '../../memory/store.ts';
import type { SessionStore } from '../../session/store.ts';
import { withUiStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunChatTurn } from './run-turn.ts';
import { buildTaskFromMessages, latestUserMessage, textOf } from './task.ts';

/** `uploadsDir` is optional so existing fakes/tests that never send
 *  `uploadIds` (and so never touch upload-path resolution) don't need to
 *  supply it; the real server (`src/server/main.ts`) always sets it.
 *  `sessionStore`/`memoryStore` are optional for the identical reason: every
 *  pre-existing chat test that never exercises persistence/auto-ingest keeps
 *  passing untouched, while the real server always supplies both (Slice 30b
 *  Phase 6, D3/D4/D5/D6). */
export type ChatHandlerDeps = {
  runChatTurn: RunChatTurn;
  uploadsDir?: string;
  sessionStore?: SessionStore;
  memoryStore?: MemoryStore;
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

/**
 * `POST /api/chat` — parse the request, build the orchestrator `task` from
 * the message history, and stream the turn back as an AI-SDK SSE UI-message
 * stream: `StatusEvent`s become transient `data-*` parts (the enum values
 * ARE the AI-SDK data-part type names) and the orchestrator's own token
 * stream is merged straight through.
 *
 * Turn-boundary persistence (Slice 30b Phase 6, D3/D4/D7, spec §7.1): when
 * `sessionId` + `sessionStore` are both present, the user's ask is upserted
 * and appended HERE, in this function's own synchronous body — well before
 * `createUIMessageStream` (and so before the Response, and any first token,
 * ever exist), which is what satisfies §7.1(a). The assistant's answer
 * persists later, inside `execute`'s `try` block, only once
 * `deps.runChatTurn(...)` has actually resolved — reusing the SAME `result`
 * value the stream-outcome branch already computes, no extra stream tap; a
 * thrown/aborted turn skips straight to `catch`, so the assistant row is
 * simply never written (§7.1(b)/(e) — a deliberate, visible gap, not
 * silent data loss).
 *
 * Auto-ingest (Slice 30b Phase 6, D5/D6): when `sessionId` + `memoryStore`
 * are both present, the completed turn (user ask + assistant answer) is
 * fire-and-forgotten into the shared `chat` memory space via
 * `rememberOnce` — deliberately NOT awaited, so the SSE response is free to
 * end without waiting on an embedding round-trip.
 *
 * See `tests/server/chat-handler-persistence.test.ts` (T26) and
 * `tests/server/chat-handler-auto-ingest.test.ts` (this task) for the
 * adversarially-verified requirements.
 */
export async function handleChat(
  req: Request,
  deps: ChatHandlerDeps,
): Promise<Response> {
  let body: ReturnType<typeof ChatRequestSchema.parse>;
  try {
    body = ChatRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid chat request' }, 400);
  }

  const task = buildTaskFromMessages(body.messages);
  const sessionId = body.sessionId;
  const lastUserMsg = latestUserMessage(body.messages);

  // Turn-boundary persistence, part 1 of 2 (D3/D4, §7.1(a)/(c)): the user's
  // ask is durably written BEFORE any engine work starts — this whole block
  // is plain synchronous code in `handleChat`'s own body, not inside
  // `execute`, so nothing below this point can produce output before these
  // calls have returned. `upsertSession`'s `INSERT OR IGNORE` (§7.1(c)) and
  // `appendMessage`'s `INSERT OR IGNORE` on `msg.id` make a retried request
  // for the SAME sessionId/message a safe no-op, never a constraint-
  // violation throw.
  if (sessionId && deps.sessionStore) {
    const startedAt = Date.now();
    deps.sessionStore.upsertSession(sessionId, {
      defaultTitle:
        (lastUserMsg ? textOf(lastUserMsg) : '').slice(0, 80) || 'New chat',
      at: startedAt,
    });
    if (lastUserMsg) {
      deps.sessionStore.appendMessage(
        sessionId,
        { id: lastUserMsg.id, role: lastUserMsg.role, parts: lastUserMsg.parts },
        startedAt,
      );
    }
  }

  // Media-by-reference (Task 16): the browser sends opaque ids minted by a
  // PRIOR `POST /api/upload`, never a raw filesystem path. Resolve each id
  // back to an absolute path through the SAME `confineToDir` primitive the
  // upload endpoint validates its write with — this is the read-side half of
  // that defense-in-depth pair. A bad/escaping id 400s the whole request
  // before any engine work starts (no partial media, no silent drop).
  let media: IngestFlags | undefined;
  if (body.uploadIds && body.uploadIds.length > 0) {
    if (!deps.uploadsDir) {
      return json(
        { error: 'invalid chat request: uploads are not configured' },
        400,
      );
    }
    const images: string[] = [];
    for (const uploadId of body.uploadIds) {
      try {
        images.push(confineToDir(uploadId, deps.uploadsDir));
      } catch (err) {
        if (err instanceof MediaPathError) {
          return json(
            { error: 'invalid chat request: unknown upload id' },
            400,
          );
        }
        throw err;
      }
    }
    media = {
      images,
      audios: [],
      videos: [],
      paste: false,
      voice: false,
      voiceIn: [],
    };
  }

  // The `ui.stream` span MUST wrap the work INSIDE `execute` — not the outer
  // handler body. `createUIMessageStream` does NOT await its `execute`
  // callback, so an outer wrap would return (building the Response) in ~1
  // tick and fire the span's `finally` before the turn ran, recording
  // `{chunks:0, outcome:'unknown'}` for every latency-bearing request. Inside
  // `execute`, the span brackets the awaited `runChatTurn` (which drains the
  // orchestrator stream via `consumeStream()` before resolving), so the
  // span's `finally` records the real outcome + status-event chunk count.
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
        // D7: tapped alongside the existing status-event write below — a
        // Degrade event marks the WHOLE turn degraded (never un-marked by a
        // later event); RunStart's runId is captured the same way so the
        // persisted assistant row can carry it (closes Increment 1's
        // flagged `sessions.run_id`-never-written gap, via T21's extension).
        let degradedThisTurn = false;
        let capturedRunId: string | undefined;
        const events: EventSink = (e) => {
          writer.write({ type: e.type, data: e, transient: true });
          // Best-effort: this counts status-event writes only. The merged
          // orchestrator token stream isn't per-chunk observable here without
          // an extra tap on the ReadableStream passed to `streamSink` — that
          // instrumentation is deferred (documented, not implemented).
          rec.chunk(JSON.stringify(e).length);
          if (e.type === StatusEventType.Degrade) degradedThisTurn = true;
          if (e.type === StatusEventType.RunStart) capturedRunId = e.runId;
        };
        const streamSink: StreamSink = (s) => writer.merge(s);
        try {
          const result = await deps.runChatTurn({
            task,
            media,
            events,
            stream: streamSink,
            signal: req.signal,
          });
          // For 'answer', the text already streamed token-by-token via
          // `streamSink`/`writer.merge` above — nothing more to write. For
          // 'gap'/'resource', the orchestrator only SYNTHESIZES `result.message`
          // AFTER generation finishes (see `runOrchestrator`), so nothing has
          // reached the stream yet; without this, the browser renders an empty
          // assistant bubble (the CLI doesn't have this gap — it prints
          // `result.message` directly). Write it as a one-shot text part.
          const assistantText =
            result.kind === 'answer' ? result.text : result.message;
          if (result.kind !== 'answer') {
            const id = `outcome-${result.kind}`;
            writer.write({ type: 'text-start', id });
            writer.write({ type: 'text-delta', id, delta: assistantText });
            writer.write({ type: 'text-end', id });
          }
          // Turn-boundary persistence, part 2 of 2 (D3/D4/D7, §7.1(b)/(e)):
          // reached ONLY after `runChatTurn` has actually resolved — a throw
          // above (caught below) skips this entirely, so a dropped
          // connection/turn leaves the assistant row simply absent, never
          // partial. The assistant message's id is server-minted: the AI-SDK
          // client mints its own display id independently, so there is no
          // client-generated id available here to reuse — this same id is
          // what the auto-ingest `source` string below is built from,
          // keeping every turn's dedup key unique (§7.1(d)).
          const assistantMsgId = `asst-${crypto.randomUUID()}`;
          if (sessionId && deps.sessionStore) {
            deps.sessionStore.appendMessage(
              sessionId,
              {
                id: assistantMsgId,
                role: ChatRole.Assistant,
                parts: [{ type: 'text', text: assistantText }],
                degraded: degradedThisTurn,
                runId: capturedRunId,
              },
              Date.now(),
            );
          }
          // Auto-ingest (D5/D6): fire-and-forget — `void`, never awaited —
          // so the SSE response can end without waiting on an embedding
          // round-trip (the store's own `memory.recall`/`memory.ingest`
          // spans already prove that round-trip is not instant).
          if (sessionId && deps.memoryStore) {
            const userText = lastUserMsg ? textOf(lastUserMsg) : '';
            void deps.memoryStore.rememberOnce(
              `user: ${userText}\nassistant: ${assistantText}`,
              {
                space: CHAT_MEMORY_SPACE,
                namespace: sessionId,
                source: `chat:${sessionId}:${assistantMsgId}`,
                at: Date.now(),
              },
            );
          }
          rec.outcome(result.kind);
        } catch (err) {
          rec.outcome('error');
          // Re-throw so `createUIMessageStream` emits its own typed error
          // chunk into the stream (no silent drop, no double-handling here).
          throw err;
        }
      });
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

- [ ] **Step 4: Thread `memoryStore` through `createRealRunChatTurn` in `src/server/chat/run-turn.ts`**

Read the file first. Add the import:
```typescript
import type { MemoryStore } from '../../memory/store.ts';
```

Change the function signature:
```typescript
export function createRealRunChatTurn(engine: LazyEngine): RunChatTurn {
```
to:
```typescript
export function createRealRunChatTurn(
  engine: LazyEngine,
  memoryStore?: MemoryStore,
): RunChatTurn {
```

Add `memoryStore` to the `deps` object passed to `runChatSession` (right after the existing `mediaStore: store,` line):
```typescript
        const { result } = await runChatSession({
          task,
          media,
          ingestDeps: { exists: () => false },
          events,
          stream,
          signal,
          deps: {
            registry: reg,
            selectHook,
            capture,
            run,
            ledger,
            routerNumCtx: engine.routerNumCtx(),
            mediaStore: store,
            memoryStore,
          },
        });
```

- [ ] **Step 5: Reorder `src/server/main.ts` so `memoryStore` is constructed before `runChatTurn`, and pass it through**

Read the file first. This requires moving the `runChatTurn` construction line down, past the existing `memoryStore` construction block. Replace the whole middle section of `startWebServer` — from the `const policy = ...` line through the `const deps: ServerDeps = { ... };` line — with:
```typescript
  const policy = { port, allowedOrigins };
  const runsRoot = 'runs';
  const runCrewTurn = createRealRunCrewTurn(runsRoot);
  const runWorkflowTurn = createRealRunWorkflowTurn(runsRoot);
  const runBuilderTurn = createRealRunBuilderTurn(runsRoot);
  const runModelPull = createRealRunModelPull(runsRoot);
  const mcpConfigPath = defaultConfigPath();
  const mcpMountStatus = createMcpMountStatus();
  const mountOne = createRealMcpMountOne();
  const consent = createConsentRegistry();
  // A durable dir OUTSIDE any per-run dir (Task 16): uploads must survive
  // across the per-request `/api/chat` run lifecycle since the upload and
  // the chat turn that references it are two separate HTTP requests.
  const uploadsDir = join(runsRoot, '_uploads');
  // Create it up front — before any upload ever happens — so the READ side
  // (`handleChat`'s `confineToDir(uploadId, uploadsDir)`) never hits a
  // nonexistent ROOT. `confineToDir` calls `realpathSync` on the root itself;
  // if the dir doesn't exist yet, that throws a raw `ENOENT` (not
  // `MediaPathError`), which `handleChat` doesn't catch, producing a 500
  // instead of the intended 400 for a bogus uploadId. `handleUpload` also
  // mkdirs this dir before writing (the write path was already safe); this
  // covers the read path too.
  mkdirSync(uploadsDir, { recursive: true });
  // Mirrors src/cli/memory.ts's makeRealStore — one embedder instance shared
  // by embedTexts/embedQuery, the Ollama-backed model manager for
  // ensureReady, cross-encoder rerank on by default (defaultRerank() in
  // retrieve.ts still gates actual use behind AGENT_MEMORY_RERANK).
  const memoryEmbedModel =
    process.env.AGENT_MEMORY_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
  const memoryManager = createModelManager();
  const memoryEmbedder = makeEmbedder({
    ensureReady: (decl) => memoryManager.ensureReady(decl),
    control: runtimeFor(RuntimeKind.Ollama).control,
    model: memoryEmbedModel,
  });
  const memoryStore = createMemoryStore(
    { embedModel: memoryEmbedModel },
    {
      embedTexts: memoryEmbedder.embed,
      embedQuery: async (text) =>
        (await memoryEmbedder.embed([text]))[0] as number[],
      probe: probeEmbedder,
      reranker: makeCrossEncoderReranker(),
    },
  );
  // Cheap + synchronous, mirroring memoryStore's own construction discipline
  // just above (SqliteStore's constructor runs mkdirSync + opens the db +
  // migrates — no Ollama/network dependency at construction time).
  const sessionStore = createSessionStore(
    { path: String(cfg.AGENT_SESSIONS_PATH) },
    {},
  );
  // Lazy engine: nothing (registry build, model manager, MCP mount) runs at
  // boot — only on the FIRST `/api/chat` request — so server startup and the
  // perimeter/health tests stay Ollama-free. `memoryStore` threads through so
  // `runChatSession`'s `injectRecall` call (Slice 30b Phase 6, D5) gets the
  // SAME store instance the auto-ingest write path (below) uses.
  const runChatTurn = createRealRunChatTurn(
    createLazyEngine(runsRoot),
    memoryStore,
  );
  // Serve the real built app when it exists (`cd web && bun run build`);
  // fall back to the Phase-1 stub otherwise (unbuilt/Ollama-free dev + tests).
  const distIndexHtml = readWebDistIndexHtml();
  const staticDir =
    opts.staticDir ?? (existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined);

  const deps: ServerDeps = {
    token,
    policy,
    recordIo,
    staticDir,
    indexHtml: renderIndexHtml(token, distIndexHtml),
    runChatTurn,
    consent,
    uploadsDir,
    runsRoot,
    runCrewTurn,
    runWorkflowTurn,
    runBuilderTurn,
    runModelPull,
    freeDiskBytes,
    mcpConfigPath,
    mcpMountStatus,
    mountOne,
    memoryStore,
    sessionStore,
  };
```
Add the `createSessionStore` import (if T25 didn't already leave it in place — confirm it's present):
```typescript
import { createSessionStore } from '../session/store.ts';
```

- [ ] **Step 6: Run the new auto-ingest tests to verify they pass**

Run: `bun test tests/server/chat-handler-auto-ingest.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Run the T26 persistence suite + the pre-existing chat-handler suite to confirm zero regression**

Run: `bun test tests/server/chat-handler-persistence.test.ts tests/server/chat-handler.test.ts tests/server/main.test.ts`
Expected: PASS, all unchanged — `memoryStore` is optional on `ChatHandlerDeps` and `createRealRunChatTurn`'s new second param is optional, so no pre-existing fixture needs updating.

- [ ] **Step 8: Full server-suite regression**

Run: `bun test tests/server/`
Expected: PASS.

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/chat/handler.ts src/server/chat/run-turn.ts src/server/main.ts tests/server/chat-handler-auto-ingest.test.ts
git add src/server/chat/handler.ts src/server/chat/run-turn.ts src/server/main.ts tests/server/chat-handler-auto-ingest.test.ts
git commit -m "feat(server): thread memoryStore into the chat engine seam + fire fire-and-forget auto-ingest (Phase 6 Incr 3, D5/D6)"
```

---

## Task T31: CLI `chat.ts` wires `memoryStore` via an exported `makeRealStore` (READ benefit only, D5)

**Files:**
- Modify: `src/cli/memory.ts` (export the existing private `makeRealStore` function — no behavior change)
- Modify: `src/cli/chat.ts` (construct + wire `memoryStore` into `runChatSession`'s deps; clean up alongside the existing `manager`)
- Test: `tests/cli/make-real-store.test.ts` (create)

**Interfaces:**
- Consumes: `makeRealStore(flags: { space?: string; ns?: string; top?: number; embed?: string }): { store: MemoryStore; manager: ReturnType<typeof createModelManager> }` (`src/cli/memory.ts`, currently un-exported — this task's ONLY change to that file is adding the `export` keyword; the function's internals are untouched).
- Produces: `src/cli/chat.ts`'s `main()` constructs a real `MemoryStore` + its own `ModelManager` up front (cheap + synchronous, mirroring `main.ts`'s server-side construction discipline), threads it into `runChatSession`'s `deps.memoryStore` (T29's field) for the READ-only recall benefit (D5 — the CLI never calls `rememberOnce`; it has no `sessionId` to namespace an auto-ingest write under), and unloads/closes it in the SAME outer `finally` block that already unloads the chat-turn `manager`.

**Design note on testability:** `chat.ts`'s `main()` is not itself unit-tested anywhere in this repo (only its exported helpers — `maybeAutoProvision`, `warnUnknownChatAgents`, `parseMediaArgs` — are), since it boots a real interactive CLI session. This task's test therefore targets the ONE new testable unit this task creates: the newly-exported `makeRealStore`, proving it constructs a real `{store, manager}` pair (with correct method shape) WITHOUT touching Ollama at construction time (confirmed by `src/memory/embed.ts`'s `makeEmbedder`/`probeEmbedder` split: probing is lazy, deferred until a space is actually used). The actual `runChatSession` wiring this enables is exercised by T29's own tests (`tests/cli/run-chat-session.test.ts`), which prove `ChatSessionDeps.memoryStore` correctly drives `injectRecall` regardless of which caller (CLI or server) constructs the store — per D5's "one shared engine seam" design.

- [ ] **Step 1: Write the failing test**

`tests/cli/make-real-store.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRealStore } from '../../src/cli/memory.ts';

describe('makeRealStore (exported for CLI recall wiring, Slice 30b Phase 6, D5)', () => {
  test('constructs a real MemoryStore + ModelManager pair without touching Ollama at construction time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-real-store-'));
    const prevPath = process.env.AGENT_MEMORY_PATH;
    process.env.AGENT_MEMORY_PATH = dir;
    try {
      const { store, manager } = makeRealStore({});
      expect(typeof store.recall).toBe('function');
      expect(typeof store.remember).toBe('function');
      expect(typeof store.rememberOnce).toBe('function');
      expect(typeof store.ingest).toBe('function');
      expect(typeof store.stats).toBe('function');
      expect(typeof store.close).toBe('function');
      store.close();
      await manager.unloadAll(); // safe no-op: nothing was ever ensureReady'd
    } finally {
      if (prevPath === undefined) delete process.env.AGENT_MEMORY_PATH;
      else process.env.AGENT_MEMORY_PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honors an --embed override for the embed model (no network call at construction)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-real-store-embed-'));
    const prevPath = process.env.AGENT_MEMORY_PATH;
    process.env.AGENT_MEMORY_PATH = dir;
    try {
      const { store } = makeRealStore({ embed: 'some-other-embedder' });
      expect(typeof store.recall).toBe('function');
      store.close();
    } finally {
      if (prevPath === undefined) delete process.env.AGENT_MEMORY_PATH;
      else process.env.AGENT_MEMORY_PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/make-real-store.test.ts`
Expected: FAIL — `makeRealStore` is not exported from `src/cli/memory.ts` yet (module has no such export).

- [ ] **Step 3: Export `makeRealStore` in `src/cli/memory.ts`**

Change:
```typescript
function makeRealStore(flags: Flags): {
```
to:
```typescript
export function makeRealStore(flags: Flags): {
```
(No other change to this file — the function body, its callers inside `src/cli/memory.ts` itself, and every other export are untouched.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli/make-real-store.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Wire `memoryStore` into `src/cli/chat.ts`'s `main()`**

Read the file first. Add the import:
```typescript
import { makeRealStore } from './memory.ts';
```

Insert the construction right after `const registry = await buildRegistry();`:
```typescript
  const registry = await buildRegistry();
  // READ-only recall benefit for the CLI (D5): the CLI never writes to the
  // `chat` memory space (it has no sessionId to namespace an auto-ingest
  // write under — see run-chat-session.ts's CHAT_MEMORY_SPACE doc comment),
  // but `runChatSession`'s `injectRecall` call benefits identically to the
  // server whenever a memoryStore is present. Construction is cheap +
  // synchronous (mirrors src/server/main.ts's own construction discipline).
  const { store: memoryStore, manager: memoryManager } = makeRealStore({});
```

Add `memoryStore` to the `runChatSession({...})` call's `deps` object (right after the existing `mediaStore: store,` line):
```typescript
            deps: {
              registry: reg,
              selectHook: onBeforeDelegate,
              capture,
              run,
              ledger,
              routerNumCtx,
              mediaStore: store,
              memoryStore,
            },
```

Extend the outer cleanup `finally` block (currently `finally { await manager.unloadAll(); }`) to also unload/close the memory store's resources:
```typescript
  } finally {
    await manager.unloadAll();
    await memoryManager.unloadAll();
    memoryStore.close();
  }
```

- [ ] **Step 6: Full CLI-suite regression**

Run: `bun test tests/cli/`
Expected: PASS — `tests/cli/chat.test.ts` only exercises `maybeAutoProvision`/`warnUnknownChatAgents` (never `main()` itself), so this change has no test surface to regress there; `tests/cli/run-chat-session.test.ts` (T29) already covers the `memoryStore`-present/-absent behavior at the `runChatSession` level, which is what `chat.ts` now actually drives.

- [ ] **Step 7: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/cli/memory.ts src/cli/chat.ts tests/cli/make-real-store.test.ts
git add src/cli/memory.ts src/cli/chat.ts tests/cli/make-real-store.test.ts
git commit -m "feat(cli): chat.ts wires memoryStore via exported makeRealStore for the read-only recall benefit (Phase 6 Incr 3, D5)"
```

---

## Task T32: Increment 2+3 completion gate (full regression, self-review, no docs edit)

**Files:** none created/modified — this task is a verification-only checkpoint before handing off to `_phase6-part-b-incr4-6.md`.

**Interfaces:** none new — this task only proves T20–T31's combined surface is internally consistent and does not regress anything else in the repo.

- [ ] **Step 1: Full typecheck + lint across every file touched across T20–T31**

```bash
bun run typecheck
bun run lint:file -- \
  src/contracts/requests.ts \
  src/session/store.ts \
  src/server/sessions/list.ts src/server/sessions/detail.ts src/server/sessions/rename.ts src/server/sessions/delete.ts \
  src/server/app.ts src/server/main.ts \
  src/server/chat/handler.ts src/server/chat/task.ts src/server/chat/run-turn.ts \
  src/telemetry/spans.ts src/memory/store.ts \
  src/cli/run-chat-session.ts src/cli/memory.ts src/cli/chat.ts \
  tests/contracts/chat-request-session-id.test.ts \
  tests/session/store.test.ts \
  tests/server/sessions-list.test.ts tests/server/sessions-detail.test.ts tests/server/sessions-mutate.test.ts tests/server/sessions-routes.test.ts \
  tests/server/app.test.ts tests/server/phase4-routes.test.ts tests/server/phase5-mcp-routes.test.ts tests/server/phase5-memory-routes.test.ts tests/server/runs-routes.test.ts \
  tests/server/chat-handler-persistence.test.ts tests/server/chat-handler-auto-ingest.test.ts \
  tests/memory/spans-remember.test.ts tests/memory/remember-once.test.ts \
  tests/cli/run-chat-session.test.ts tests/cli/make-real-store.test.ts
```
Expected: both clean (0 errors). Also run the web-side gate separately (biome does not typecheck `.tsx`):
```bash
cd web && bun run typecheck && bun run lint:file -- src/features/chat/index.tsx src/features/chat/index.test.tsx src/features/chat/actions.test.tsx src/features/chat/attachments.test.tsx src/features/chat/session.test.tsx
```
Expected: clean.

- [ ] **Step 2: Full contracts + session + memory + cli + server suites**

```bash
bun test tests/contracts/ tests/session/ tests/memory/ tests/cli/ tests/server/
```
Expected: all PASS, including every PRE-EXISTING test this increment touched only additively (`chat-handler.test.ts`, `chat-task.test.ts`, `run-chat-session.test.ts`, `main.test.ts`, and the five `ServerDeps`-constructing route-test files) — nothing outside the files this plan's own tasks list should be affected.

- [ ] **Step 3: Full web suite regression**

```bash
cd web && bun run test
```
Expected: PASS.

- [ ] **Step 4: Full repo test suite (final regression gate for both increments)**

Run: `bun run check` (docs:check · typecheck · lint · tests, per the repo's pre-PR gate)
Expected: `docs:check` will currently FAIL/WARN that `src/server/**`, `src/session/**`, `src/cli/**`, and `src/memory/**` changed without a `docs/architecture.md` edit — this is EXPECTED and correct at this point in the phase: per this plan's own Global Constraints, the full, accurate `docs/architecture.md` rewrite (new §"3g. Persistence" subsection, module-map entries, data-flow edges) is Increment 6's job (`_phase6-part-b-incr4-6.md`), not this plan's. Do not `DOCS_OK=1` bypass a push to `main` from mid-phase work; this increment's commits stay on the shared `slice-30b-phase6-persistence` branch (per the spec header), which only gets the pre-push slice-landing gate treatment when Increment 6 actually lands the whole phase to `main`.

- [ ] **Step 5: Self-review checklist (perform before considering Increments 2–3 done)**

- **Spec coverage (§5 items 2–3; D2, D3, D4, D5, D6, D7; §4.2 routes 1–4, 6–7; §4.4; §7.1):**
  - D2 (`sessionId` UUID regex) ✓ T20.
  - D1's flagged `run_id`-never-written gap ✓ T21 (closed via `appendMessage`'s new optional `runId?`).
  - §4.2 routes 1–4 (`GET /api/sessions`, `GET/PATCH/DELETE /api/sessions/:id`) ✓ T22–T24; route 5 (export) explicitly NOT built here (Increment 4) — the ordering hazard is documented at the exact insertion point (T25 Step 3's comment).
  - `ServerDeps.sessionStore` + wiring ✓ T25 (route 6, `/api/chat`, extended not rewritten — no NEW route; route 7, `ServerDeps` field — done).
  - D3/D4/D7 (turn-boundary persistence, §7.1 a–e) ✓ T26, HARD-flagged + ultracode-verified.
  - Web session-id mint/thread/rehydrate (§4.5's chat-area bullet) ✓ T27.
  - D6 (`rememberOnce` + `memory.remember` span) ✓ T28.
  - D5 read half (`ChatSessionDeps.memoryStore` + `injectRecall`, CLI+server shared) ✓ T29 (CLI wiring) + T30 (server threading) + T31 (CLI's own construction site).
  - D5 write half (server-only auto-ingest fire-and-forget) ✓ T30.
  - NOT in scope for this plan (confirmed absent from the diff): `GET /api/sessions/:id/export` (Increment 4); any Sessions UI route/page beyond `ChatArea`'s own session-id concerns (Increment 4); notifications (Increment 5); any `docs/architecture.md`/README/ROADMAP/SDD-ledger edit (Increment 6).
- **Placeholder scan:** every code block across T20–T31 is complete, runnable TypeScript/TSX — no `// TODO`, no `...`, no stub function bodies. (Verified by re-reading each Step 3/5-style code step during drafting.)
- **Type consistency:** `ChatHandlerDeps.sessionStore?`/`memoryStore?` and `ChatSessionDeps.memoryStore?` are ALL optional, preserving every pre-existing fixture's compile-ability (`uploadsDir`'s established precedent, extended twice more). `SessionStore`'s method signatures (T21's `appendMessage` extension aside) are UNCHANGED from Increment 1's locked surface — no other method gained/lost a parameter. `CHAT_MEMORY_SPACE` is a single exported string constant (`src/cli/run-chat-session.ts`) imported by BOTH the read side (`runChatSession`, T29) and the write side (`handleChat`, T30) — it cannot drift.
- **Known forward-items flagged for Increment 4+ (see the individual task notes above):** the export route's ordering hazard (T25); Sessions UI itself (list/detail/rename/delete pages, sidebar, ⌘K) has ZERO web surface built by this plan beyond `ChatArea`'s own session-id concerns — `SessionsSidebar` (`web/src/features/sessions/index.tsx`) is STILL the 15-line Phase-1 stub after this plan; Increment 4 replaces it.

- [ ] **Step 6: No commit for this task** — Task T32 is a verification checkpoint only; if Steps 1–4 are clean, Increments 2–3 are complete and ready for hand-off to `_phase6-part-b-incr4-6.md` (Sessions UI, Notifications, Docs+land). If anything fails, fix it under the FAILING task's own commit (amend that task's diff before moving on), not as a new catch-all commit here.

---

## Increments 2–3 — final produced surface (for the Increment 4–6 controller to reconcile against)

**Contracts (`src/contracts/requests.ts`):**
- `ChatRequestSchema.sessionId` — now `z.string().regex(SESSION_ID_PATTERN).optional()` (still optional; UUID-v4 shape enforced).

**Engine (`src/session/store.ts`):**
- `appendMessage(sessionId: string, msg: { id: string; role: string; parts: unknown; parentMessageId?: string; degraded?: boolean; runId?: string }, at: number): void` — `runId` extension only; every other `SessionStore` method is UNCHANGED from Increment 1.

**Server (`src/server/sessions/*.ts`, `src/server/app.ts`, `src/server/main.ts`):**
- `SessionsDeps = { sessionStore: SessionStore }` (canonical home: `src/server/sessions/list.ts`).
- `handleSessionList(params: URLSearchParams, deps: SessionsDeps): Response`
- `handleSessionDetail(id: string, deps: SessionsDeps): Response`
- `handleSessionRename(req: Request, deps: SessionsDeps, id: string): Promise<Response>`
- `handleSessionDelete(deps: SessionsDeps, id: string): Response`
- `ServerDeps.sessionStore: SessionStore` (required — every real caller has one; 5 pre-existing fixture files updated).
- Routes live: `GET /api/sessions`, `GET/PATCH/DELETE /api/sessions/:id`. **`GET /api/sessions/:id/export` is NOT yet registered** — Increment 4 MUST insert it BEFORE the bare-`:id` regex in `app.ts`.

**Chat wiring (`src/server/chat/handler.ts`, `run-turn.ts`; `src/cli/run-chat-session.ts`, `chat.ts`; `src/cli/memory.ts`):**
- `ChatHandlerDeps = { runChatTurn: RunChatTurn; uploadsDir?: string; sessionStore?: SessionStore; memoryStore?: MemoryStore }`.
- `createRealRunChatTurn(engine: LazyEngine, memoryStore?: MemoryStore): RunChatTurn`.
- `ChatSessionDeps.memoryStore?: MemoryStore`; `export const CHAT_MEMORY_SPACE = 'chat'` (`src/cli/run-chat-session.ts`) — the single source of truth for the space string, imported by both `runChatSession` (read) and `handleChat` (write).
- `makeRealStore` (`src/cli/memory.ts`) is now exported (was previously module-private).

**Memory (`src/memory/store.ts`, `src/telemetry/spans.ts`):**
- `MemoryStore.rememberOnce(text: string, o: { space?: string; namespace?: string; source: string; at: number }): Promise<{ skipped: boolean }>`.
- `withMemoryRememberSpan` + `ATTR.MEMORY_REMEMBER_SKIPPED` (`src/telemetry/spans.ts`).

**Web (`web/src/features/chat/index.tsx`):**
- `ChatArea` mints/persists/threads/rehydrates `sessionId` per D2; every `sendMessage` call now carries `{ body: { sessionId, ...(uploadIds.length > 0 ? {uploadIds} : {}) } }` — a deliberate behavior change from the pre-Phase-6 "no body override on a plain send" invariant, updated across 3 pre-existing test files (`index.test.tsx`, `actions.test.tsx`, `attachments.test.tsx`).

**Open items for Increment 4 (Sessions UI) to verify at merge:**
1. `GET /api/sessions/:id/export` does not exist yet — Increment 4 adds it AND must respect the ordering hazard documented in T25.
2. `SessionsSidebar` (`web/src/features/sessions/index.tsx`) is untouched — still the Phase-1 stub. Increment 4 replaces it entirely with a real recent-sessions list.
3. No `/sessions` or `/sessions/$id` web route exists yet.
4. `docs/architecture.md`/README/ROADMAP/the SDD ledger are UNTOUCHED by this plan (Increment 6's job) — do not treat their current state as reflecting Increments 2–3's shipped reality until Increment 6 lands.


---

# Part B — Increments 4–6: Sessions UI + Notifications + Docs / land (Tasks T51–T67)

## Task T51: Server — `GET /api/sessions/:id/export` (Markdown export)

**Files:**
- Create: `src/server/sessions/export.ts`
- Modify: `src/server/app.ts` (wire the route ahead of the bare `:id` match)
- Test: `tests/server/sessions-export.test.ts` (create)

**Interfaces:**
- Consumes: `ChatRole` (`src/contracts/enums.ts`); `ISOLATION_HEADERS` (`src/server/isolation-headers.ts`); `ServerDeps.sessionStore` (Increment 2, Part A — see Assumption 4/5 above).
- Produces: `renderSessionMarkdown(session, messages)` (pure, exported for direct unit testing); `handleSessionExport(sessionId, deps)`; `GET /api/sessions/:id/export` wired in `app.ts`, returning `text/markdown; charset=utf-8` — the server's first non-JSON API response (spec §4.2 item 5).

- [ ] **Step 1: Write the failing tests**

`tests/server/sessions-export.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  handleSessionExport,
  renderSessionMarkdown,
} from '../../src/server/sessions/export.ts';

test('renderSessionMarkdown assembles a heading per message with ISO timestamps', () => {
  const md = renderSessionMarkdown({ id: 's1', title: 'My chat' }, [
    {
      id: 'm1',
      role: ChatRole.User,
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: 0,
    },
    {
      id: 'm2',
      role: ChatRole.Assistant,
      parts: [{ type: 'text', text: 'hi there' }],
      createdAt: 1000,
      degraded: true,
    },
  ]);
  expect(md).toContain('# My chat');
  expect(md).toContain('## User — 1970-01-01T00:00:00.000Z');
  expect(md).toContain('hello');
  expect(md).toContain('## Assistant — 1970-01-01T00:00:01.000Z');
  expect(md).toContain('_(degraded)_');
  expect(md).toContain('hi there');
});

test('renderSessionMarkdown falls back to the session id for an empty title, and marks an empty message', () => {
  const md = renderSessionMarkdown({ id: 's2', title: '' }, [
    { id: 'm1', role: ChatRole.User, parts: [], createdAt: 0 },
  ]);
  expect(md).toContain('# s2');
  expect(md).toContain('_(empty)_');
});

test('renderSessionMarkdown joins multiple text parts on one message', () => {
  const md = renderSessionMarkdown({ id: 's3', title: 't' }, [
    {
      id: 'm1',
      role: ChatRole.User,
      parts: [
        { type: 'text', text: 'part one ' },
        { type: 'text', text: 'part two' },
      ],
      createdAt: 0,
    },
  ]);
  expect(md).toContain('part one part two');
});

test('handleSessionExport returns 200 text/markdown for an existing session', async () => {
  const deps = {
    sessionStore: {
      getSession: async (id: string) =>
        id === 's1' ? { id: 's1', title: 'My chat' } : undefined,
      getMessages: async () => [
        {
          id: 'm1',
          role: ChatRole.User,
          parts: [{ type: 'text', text: 'hello' }],
          createdAt: 0,
        },
      ],
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double, only the two methods above are called
  } as any;
  const res = await handleSessionExport('s1', deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe(
    'text/markdown; charset=utf-8',
  );
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  const body = await res.text();
  expect(body).toContain('hello');
});

test('handleSessionExport 404s (JSON) for a missing session', async () => {
  const deps = {
    sessionStore: {
      getSession: async () => undefined,
      getMessages: async () => [],
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double
  } as any;
  const res = await handleSessionExport('nope', deps);
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toBe(
    'application/json; charset=utf-8',
  );
  expect(await res.json()).toEqual({ error: 'not found' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/sessions-export.test.ts`
Expected: FAIL — `src/server/sessions/export.ts` does not exist yet.

- [ ] **Step 3: Create `src/server/sessions/export.ts`**

```typescript
import type { ChatRole } from '../../contracts/enums.ts';
import type { SessionStore } from '../../session/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type SessionExportDeps = { sessionStore: SessionStore };

/**
 * A raw stored message, as `SessionStore.getMessages` returns it — the
 * engine-side shape (parsed `parts` JSON), NOT the wire `ChatMessageDTO`
 * projection `GET /api/sessions/:id` uses for rehydrate. Export deliberately
 * reads the raw store, not the DTO (spec D8): Markdown is a one-shot server
 * render, not a live wire contract, so it needs no additional DTO. See the
 * plan's "Assumptions carried from Increments 1–3" note #5 — if Part A's
 * `getMessages` returns a differently-shaped row, only this local type (and
 * `messageText`'s field reads) need adjusting, not this file's structure.
 */
type StoredMessagePart = { type: string; text?: string };
type StoredMessage = {
  id: string;
  role: ChatRole;
  parts: StoredMessagePart[];
  createdAt: number;
  degraded?: boolean;
};

function messageText(parts: StoredMessagePart[]): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

function roleHeading(role: ChatRole): string {
  const s = String(role);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pure Markdown assembly — exported for direct unit testing (no store, no
 * Response plumbing). One `##` heading per message with an ISO timestamp, a
 * `_(degraded)_` marker when the persisted row carries one (spec D7), and an
 * `_(empty)_` placeholder for a message with no text parts.
 */
export function renderSessionMarkdown(
  session: { id: string; title: string },
  messages: StoredMessage[],
): string {
  const lines: string[] = [`# ${session.title || session.id}`, ''];
  for (const m of messages) {
    lines.push(
      `## ${roleHeading(m.role)} — ${new Date(m.createdAt).toISOString()}`,
    );
    if (m.degraded) lines.push('_(degraded)_');
    lines.push('');
    lines.push(messageText(m.parts) || '_(empty)_');
    lines.push('');
  }
  return lines.join('\n');
}

function jsonError(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `GET /api/sessions/:id/export` (spec §4.2 item 5) — the server's FIRST
 * non-JSON API response: `text/markdown`, not `json()`. Reads the session
 * plus its full raw transcript straight from `SessionStore` (never truncated
 * by client-side history — D9's whole point), 404s (JSON, matching every
 * other route's 404 shape) when the session doesn't exist.
 */
export async function handleSessionExport(
  sessionId: string,
  deps: SessionExportDeps,
): Promise<Response> {
  const session = await deps.sessionStore.getSession(sessionId);
  if (!session) return jsonError({ error: 'not found' }, 404);
  const messages = await deps.sessionStore.getMessages(sessionId);
  const md = renderSessionMarkdown(session, messages as StoredMessage[]);
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/sessions-export.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Wire the route in `src/server/app.ts`**

Read the current `src/server/app.ts` first — Increment 2 (Part A) already added the `GET/PATCH/DELETE /api/sessions/:id` block and the `GET /api/sessions` list route. Locate the bare-`:id` sessions block (expected to look like the existing `crewDetail`/`wfDetail` pattern, e.g. a `sessionDetailMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)` guarding GET/PATCH/DELETE) and insert the export match **immediately above it** — the same stream-before-detail ordering discipline already applied to `/api/runs/:id/stream` (`app.ts:160-179`) and documented inline there.

Add the import near the other route-handler imports:
```typescript
import { handleSessionExport } from './sessions/export.ts';
```

Insert this block immediately before the bare sessions `:id` dispatch (adapt the exact surrounding `if`/`const` shape to whatever Part A actually wrote — the invariant that must hold is "export match runs before the bare-id match"):
```typescript
// Export match MUST precede the bare-:id detail/rename/delete match, same
// ordering discipline as /api/runs/:id/stream vs /api/runs/:id (Phase 3).
const sessionExportMatch = url.pathname.match(
  /^\/api\/sessions\/([^/]+)\/export$/,
);
if (req.method === 'GET' && sessionExportMatch?.[1]) {
  const res = await handleSessionExport(sessionExportMatch[1], deps);
  rec.status(res.status);
  return res;
}
```

- [ ] **Step 6: Add an app-level route-ordering regression test**

Append to `tests/server/sessions-export.test.ts` (requires a real `buildFetch`/`ServerDeps` fixture — read `tests/server/` for the nearest existing full-`ServerDeps` fixture helper, e.g. the one `tests/server/main.test.ts` or a crews/workflows route test uses, and reuse it rather than hand-rolling a second one):
```typescript
test('the export route wins over the bare :id detail route for the same session', async () => {
  // This test intentionally documents the *contract*, not the plumbing —
  // adapt to whatever ServerDeps test fixture already exists in this repo
  // for a full buildFetch(deps) round trip (see e.g. tests/server/main.test.ts
  // for the startWebServer-based pattern, or a sessions-list/-detail test
  // Increment 2 added). The assertion that matters: a GET to
  // `/api/sessions/:id/export` returns text/markdown, never the JSON
  // SessionDTO the bare :id route would return.
});
```
(If Increment 2 already ships a shared `ServerDeps` test fixture for sessions routes, replace the stub above with a real request through `buildFetch(deps)` asserting the content-type; do not leave the stub in — this step's job is to prove the ordering, not merely restate the plan.)

- [ ] **Step 7: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/sessions/export.ts src/server/app.ts tests/server/sessions-export.test.ts
bun test tests/server/sessions-export.test.ts
git add src/server/sessions/export.ts src/server/app.ts tests/server/sessions-export.test.ts
git commit -m "feat(server): GET /api/sessions/:id/export — Markdown transcript export (Phase 6)"
```

---

## Task T52: Web — `downloadBlob` helper (D9)

**Files:**
- Create: `web/src/shared/download.ts`
- Test: `web/src/shared/download.test.ts` (create)

**Interfaces:**
- Consumes: nothing (pure DOM helper — no fetch inside it; the fetch-with-Bearer-token happens at the call site, T54).
- Produces: `downloadBlob(filename, text, mime): void`.

- [ ] **Step 1: Write the failing test**

`web/src/shared/download.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download.ts';

describe('downloadBlob', () => {
  it('creates an object URL, clicks a synthetic download anchor, then revokes the URL', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadBlob('session-abc.md', '# hello', 'text/markdown;charset=utf-8');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blobArg] = createObjectURL.mock.calls[0] as [Blob];
    expect(blobArg.type).toBe('text/markdown;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });

  it('sets the anchor download attribute to the given filename before clicking', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedDownload: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        capturedDownload = this.download;
      },
    );

    downloadBlob('session-abc.md', 'text', 'text/markdown');
    expect(capturedDownload).toBe('session-abc.md');
    vi.restoreAllMocks();
  });

  it('removes the synthetic anchor from the DOM after clicking (no leaked nodes)', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    const before = document.body.childElementCount;
    downloadBlob('f.md', 't', 'text/markdown');
    expect(document.body.childElementCount).toBe(before);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/shared/download.test.ts`
Expected: FAIL — `web/src/shared/download.ts` does not exist yet.

- [ ] **Step 3: Create `web/src/shared/download.ts`**

```typescript
/**
 * Triggers a browser "Save As" download of `text` via a synthetic
 * `<a download>` click on a Blob object URL. Per D9, the export route must
 * be *fetched* (Bearer token), never bare-linked (`<a href="/api/...">` would
 * 401 with no Authorization header) — this helper only handles the
 * already-fetched-text → file-download mechanic; the actual `fetch` with the
 * Bearer header happens at the call site (mirrors `attachments.ts`'s
 * raw-`fetch`-because-`apiFetch`-forces-JSON precedent).
 */
export function downloadBlob(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/shared/download.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Gate + commit**

```bash
bun run lint:file -- web/src/shared/download.ts web/src/shared/download.test.ts
cd web && bun run typecheck && bun run test
cd ..
git add web/src/shared/download.ts web/src/shared/download.test.ts
git commit -m "feat(web): downloadBlob helper — Blob + synthetic <a download> (Phase 6, D9)"
```

---

## Task T53: Web — `/sessions` route (`SessionsArea`)

**Files:**
- Create: `web/src/features/sessions/sessions-area.tsx`
- Test: `web/src/features/sessions/sessions-area.test.tsx` (create)
- Modify: `web/src/app/router.tsx` (register the route)
- Modify: `web/src/app/app-shell.tsx` (NAV entry)
- Modify: `web/src/app/app-shell.test.tsx` (8th nav label)

**Interfaces:**
- Consumes: `SessionListResponse`/`SessionListResponseSchema` (`@contracts`, Increment 1, Part A); `apiFetch` (`web/src/shared/contract/client.ts`); `RegionErrorBoundary`, `Button`.
- Produces: `SessionsArea` component; registers `/sessions` in `routeTree`; adds a "Sessions" nav link.

- [ ] **Step 1: Write the failing test**

`web/src/features/sessions/sessions-area.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const page = {
  items: [
    {
      id: 'sess-1',
      title: 'Debugging the parser',
      owner: 'local',
      createdAt: 1000,
      updatedAt: 2000,
      lastMessageAt: 2000,
    },
  ],
  total: 1,
};

describe('SessionsArea', () => {
  it('lists sessions fetched from /api/sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-sessions')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No sessions yet" when the page has no items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('No sessions yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/sessions');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('re-fetches with a search query string when the search box changes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId('sessions-search'), {
      target: { value: 'parser' },
    });

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('search=parser');
    });
    vi.unstubAllGlobals();
  });

  it('requests the next page via cursor when Next is clicked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=')) return jsonResponse({ items: [], total: 1 });
      return jsonResponse({ ...page, nextCursor: 'abc' });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );

    const nextButton = await screen.findByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('cursor=abc');
    });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/sessions/sessions-area.test.tsx`
Expected: FAIL — `sessions-area.tsx` doesn't exist; `/sessions` isn't a registered route; `renderAt('/sessions')` 404s (no `area-sessions` testid found).

- [ ] **Step 3: Create `web/src/features/sessions/sessions-area.tsx`**

```typescript
import type { SessionListResponse } from '@contracts';
import { SessionListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

type Query = { search: string };
const emptyQuery: Query = { search: '' };

function toQueryString(query: Query, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/sessions?${qs}` : '/sessions';
}

/**
 * Sessions history: search + cursor-paginated rows linking into
 * `/sessions/$sessionId` — mirrors `RunsArea` (`features/runs/index.tsx`)
 * exactly, minus the outcome/degraded/kind facets that don't apply to
 * sessions (spec D10: the identical opaque-cursor `{items, nextCursor?,
 * total}` contract, SQL-backed server-side instead of an in-process array).
 */
export function SessionsArea() {
  const [query, setQuery] = useState<Query>(emptyQuery);
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<SessionListResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const cursor = cursors.at(-1);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toQueryString(query, cursor), {
      schema: SessionListResponseSchema,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load sessions',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, cursor]);

  function updateQuery(patch: Partial<Query>) {
    setCursors([]);
    setQuery((prev) => ({ ...prev, ...patch }));
  }

  function goNext() {
    const next = page?.nextCursor;
    if (next) setCursors((prev) => [...prev, next]);
  }

  function goFirst() {
    setCursors([]);
  }

  return (
    <RegionErrorBoundary region="Sessions">
      <section
        data-testid="area-sessions"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Sessions</h1>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            data-testid="sessions-search"
            type="search"
            placeholder="Search sessions…"
            value={query.search}
            onChange={(e) => updateQuery({ search: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Sessions</strong>{' '}
            failed to load. {error}
          </div>
        )}

        {!error && page && page.items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No sessions yet
          </p>
        )}

        {!error && page && page.items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {page.items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: item.id }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">
                    {item.title || item.id}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {new Date(
                      item.lastMessageAt ?? item.updatedAt,
                    ).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-2">
          {cursors.length > 0 && <Button onClick={goFirst}>First page</Button>}
          {page?.nextCursor && <Button onClick={goNext}>Next</Button>}
        </div>
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Register the route in `web/src/app/router.tsx`**

Add the import alongside the other feature imports:
```typescript
import { SessionsArea } from '../features/sessions/sessions-area.tsx';
```
Add the route to `routeTree`'s children array (position after `route('/', ChatArea)`, matching Sessions' conceptual place as chat history):
```typescript
  route('/', ChatArea),
  route('/sessions', SessionsArea),
  route('/crews', CrewsArea),
```
(`/sessions/$sessionId` is registered by T54 — do not add it here yet, to keep this task's diff isolated to the list route.)

- [ ] **Step 5: Add the NAV entry in `web/src/app/app-shell.tsx`**

```typescript
const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Chat' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/crews', label: 'Crews' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/builders', label: 'Builders' },
  { to: '/runs', label: 'Runs' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];
```

- [ ] **Step 6: Update `web/src/app/app-shell.test.tsx`'s 7-area assertion to 8**

```typescript
  it('renders navigation for all 8 areas', async () => {
    renderAt('/');
    for (const label of [
      'Chat',
      'Sessions',
      'Crews',
      'Workflows',
      'Builders',
      'Runs',
      'Library',
      'Settings',
    ]) {
      expect(
        await screen.findByRole('link', { name: label }),
      ).toBeInTheDocument();
    }
  });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/sessions/sessions-area.test.tsx src/app/app-shell.test.tsx`
Expected: PASS (all).

- [ ] **Step 8: Gate + commit**

```bash
bun run lint:file -- web/src/features/sessions/sessions-area.tsx web/src/features/sessions/sessions-area.test.tsx web/src/app/router.tsx web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/sessions/sessions-area.tsx web/src/features/sessions/sessions-area.test.tsx web/src/app/router.tsx web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx
git commit -m "feat(web): /sessions route — SessionsArea list (search + cursor pagination, Phase 6)"
```

---

## Task T54: Web — `/sessions/$sessionId` route (`SessionDetail`: view + rename + delete + export)

**Files:**
- Create: `web/src/features/sessions/session-detail.tsx`
- Test: `web/src/features/sessions/session-detail.test.tsx` (create)
- Modify: `web/src/app/router.tsx` (register the route)

**Interfaces:**
- Consumes: `SessionDTO`/`SessionDtoSchema` (`@contracts`); `apiFetch`, `sessionToken`, `ApiError` (`web/src/shared/contract/client.ts`); `downloadBlob` (T52).
- Produces: `SessionDetail` component; registers `/sessions/$sessionId`.

- [ ] **Step 1: Write the failing test**

`web/src/features/sessions/session-detail.test.tsx`:
```typescript
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import * as downloadModule from '../../shared/download.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const session = {
  id: 'sess-1',
  title: 'Debugging the parser',
  owner: 'local',
  createdAt: 1000,
  updatedAt: 2000,
  lastMessageAt: 2000,
  messages: [
    { id: 'm1', role: 'user', text: 'why does this fail' },
    { id: 'm2', role: 'assistant', text: 'because of X', degraded: false },
  ],
};

describe('SessionDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transcript from GET /api/sessions/:id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session)),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByText('why does this fail')).toBeInTheDocument(),
    );
    expect(screen.getByText('because of X')).toBeInTheDocument();
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });

  it('renames the session (PATCH) then re-fetches the detail', async () => {
    const calls: string[] = [];
    let renamed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (init?.method === 'PATCH') {
          renamed = true;
          return new Response(null, { status: 200 });
        }
        return jsonResponse(
          renamed ? { ...session, title: 'New title' } : session,
        );
      }),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-title-input')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('session-title-input'), {
      target: { value: 'New title' },
    });
    fireEvent.click(screen.getByTestId('session-rename-button'));
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === 'Session New title'),
      ).toBeInTheDocument(),
    );
    expect(calls.some((u) => u.endsWith('/sessions/sess-1'))).toBe(true);
  });

  it('deletes the session (DELETE) then navigates to /sessions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 200 })
          : jsonResponse(session),
      ),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-delete-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-delete-button'));
    await waitFor(() =>
      expect(screen.getByTestId('area-sessions')).toBeInTheDocument(),
    );
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn(async () => jsonResponse(session));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-delete-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-delete-button'));
    await waitFor(() =>
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });

  it('exports the session by fetching Markdown then calling downloadBlob', async () => {
    const downloadSpy = vi
      .spyOn(downloadModule, 'downloadBlob')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/export')
          ? new Response('# Debugging the parser', {
              status: 200,
              headers: { 'content-type': 'text/markdown; charset=utf-8' },
            })
          : jsonResponse(session),
      ),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-export-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-export-button'));
    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));
    const [filename, text, mime] = downloadSpy.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(filename).toBe('session-sess-1.md');
    expect(text).toBe('# Debugging the parser');
    expect(mime).toContain('text/markdown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/sessions/session-detail.test.tsx`
Expected: FAIL — `session-detail.tsx` doesn't exist; `/sessions/$sessionId` isn't registered.

- [ ] **Step 3: Create `web/src/features/sessions/session-detail.tsx`**

```typescript
import type { SessionDTO } from '@contracts';
import { SessionDtoSchema } from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch, ApiError, sessionToken } from '../../shared/contract/client.ts';
import { downloadBlob } from '../../shared/download.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/**
 * Route entry: mounts a fresh view per session via `key`, mirroring
 * `RunDetail`/`CrewDetail`'s remount-on-nav pattern — without it, session
 * A's loaded transcript would linger while session B's params race in.
 */
export function SessionDetail() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' });
  return <SessionDetailView key={sessionId} sessionId={sessionId} />;
}

function SessionDetailView({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Mirrors MemoryTab's `refreshSpaces` idiom (`library/memory-tab.tsx:50-58`):
  // a plain function, called directly by the mount effect AND after a
  // mutation, rather than a memoized callback with a dependency array to
  // fight. No cancelled-flag guard is needed — this component fully remounts
  // per sessionId via the `key` above (same reasoning as CrewDetailView).
  function loadSession() {
    apiFetch(`/sessions/${sessionId}`, { schema: SessionDtoSchema })
      .then((result) => {
        setSession(result);
        setTitleDraft(result.title);
        setError(undefined);
      })
      .catch((err: unknown) => {
        setSession(undefined);
        setError(
          err instanceof Error ? err.message : 'failed to load session',
        );
      });
  }

  useEffect(() => {
    setSession(undefined);
    loadSession();
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadSession is a fresh closure per render; only sessionId should retrigger the initial load (this component fully remounts per session via key={sessionId} at the route level)
  }, [sessionId]);

  // Rename/delete deliberately use raw `fetch` (not `apiFetch`) and never
  // parse the response body — correct regardless of whether the server
  // returns the full updated SessionDTO, a bare {ok}, or an empty 204 (see
  // the plan's "Assumptions carried from Increments 1-3" note #6).
  async function handleRename() {
    if (!titleDraft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${sessionToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      if (!res.ok) throw new ApiError('rename failed', res.status);
      loadSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this session? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      if (!res.ok) throw new ApiError('delete failed', res.status);
      navigate({ to: '/sessions' });
    } catch (err: unknown) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'delete failed');
    }
  }

  async function handleExport() {
    setError(undefined);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`, {
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      if (!res.ok) throw new ApiError('export failed', res.status);
      const text = await res.text();
      downloadBlob(
        `session-${sessionId}.md`,
        text,
        'text/markdown;charset=utf-8',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'export failed');
    }
  }

  return (
    <RegionErrorBoundary region="Session">
      <section
        data-testid="session-detail"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Session {session?.title || sessionId}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Session</strong>{' '}
            failed. {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            data-testid="session-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          />
          <Button
            data-testid="session-rename-button"
            disabled={busy}
            onClick={handleRename}
          >
            Rename
          </Button>
          <Button
            data-testid="session-export-button"
            disabled={busy}
            onClick={handleExport}
          >
            Export
          </Button>
          <Button
            data-testid="session-delete-button"
            variant="accent"
            disabled={busy}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>

        {session && (
          <ul
            data-testid="session-messages"
            className="mt-4 flex flex-1 flex-col gap-3 overflow-auto"
          >
            {session.messages.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)]"
              >
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  {m.role}
                  {m.degraded && ' · degraded'}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
```

- [ ] **Step 4: Register the route in `web/src/app/router.tsx`**

```typescript
import { SessionDetail } from '../features/sessions/session-detail.tsx';
```
```typescript
  route('/sessions', SessionsArea),
  route('/sessions/$sessionId', SessionDetail),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/sessions/session-detail.test.tsx`
Expected: PASS (all six).

- [ ] **Step 6: Gate + commit**

```bash
bun run lint:file -- web/src/features/sessions/session-detail.tsx web/src/features/sessions/session-detail.test.tsx web/src/app/router.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/sessions/session-detail.tsx web/src/features/sessions/session-detail.test.tsx web/src/app/router.tsx
git commit -m "feat(web): /sessions/\$sessionId — SessionDetail (view + rename + delete + export, Phase 6)"
```

---

## Task T55: Web — real `SessionsSidebar` (recent list)

**Files:**
- Modify: `web/src/features/sessions/index.tsx` (replace the 15-line stub)
- Test: `web/src/features/sessions/index.test.tsx` (create)

**Interfaces:**
- Consumes: `SessionListResponseSchema` (`@contracts`); `apiFetch`.
- Produces: `SessionsSidebar` — a real recent-sessions list (mounted already, unchanged import path, in `app-shell.tsx`).

- [ ] **Step 1: Write the failing test**

`web/src/features/sessions/index.test.tsx`:
```typescript
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SessionsSidebar', () => {
  it('shows "No sessions yet" before any session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByText('No sessions yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('lists recent sessions from GET /api/sessions?limit=10', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('limit=10');
      return jsonResponse({
        items: [
          {
            id: 'sess-1',
            title: 'Debugging the parser',
            owner: 'local',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        total: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('links each row to /sessions/$sessionId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 'sess-2',
              title: 'Another chat',
              owner: 'local',
              createdAt: 0,
              updatedAt: 0,
            },
          ],
          total: 1,
        }),
      ),
    );
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'Another chat' });
    expect(link).toHaveAttribute('href', '/sessions/sess-2');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/sessions/index.test.tsx`
Expected: FAIL — the stub renders "History arrives in Phase 6", not a fetched list.

- [ ] **Step 3: Replace `web/src/features/sessions/index.tsx`**

```typescript
import type { SessionListResponse } from '@contracts';
import { SessionListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

const SIDEBAR_LIMIT = 10;
/**
 * There is no shared event bus between `ChatArea`'s session-minting (Part A,
 * Increment 2) and this sidebar, so "refresh after session-create" is
 * approximated with a light interval poll rather than a direct callback — a
 * documented, deliberate simplification (see the plan's "Assumptions carried
 * from Increments 1-3" note #7).
 */
const SIDEBAR_POLL_MS = 10_000;

/** The AppShell's left rail: the 10 most-recently-active sessions, linking
 *  into `/sessions/$sessionId`. Replaces the Phase-1 placeholder stub. */
export function SessionsSidebar() {
  const [items, setItems] = useState<SessionListResponse['items']>([]);

  function refresh() {
    apiFetch(`/sessions?limit=${SIDEBAR_LIMIT}`, {
      schema: SessionListResponseSchema,
    })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, SIDEBAR_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside
      data-testid="sessions-sidebar"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
      <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Sessions
      </h2>
      {items.length === 0 && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          No sessions yet
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: s.id }}
              className="block truncate rounded px-2 py-1 font-mono text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              {s.title || s.id}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/sessions"
        className="mt-3 block font-mono text-xs text-[var(--color-accent)]"
      >
        See all →
      </Link>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/sessions/index.test.tsx`
Expected: PASS (all three).

- [ ] **Step 5: Run the full web suite (this file is imported by every route via AppShell)**

Run: `cd web && bun run test`
Expected: PASS across the board — every existing test that renders via `renderAt` now also mounts `SessionsSidebar`; confirm no test broke from the added `/api/sessions?limit=10` fetch call racing an existing test's own fetch-call assertions (most existing tests stub `fetch` generically and don't assert on call count/order in a way `/api/sessions` would disturb — if any DO regress, the fix is scoping that test's mock to only respond to the URL it cares about and returning an empty items page for anything else, not weakening this task's assertions).

- [ ] **Step 6: Gate + commit**

```bash
bun run lint:file -- web/src/features/sessions/index.tsx web/src/features/sessions/index.test.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/sessions/index.tsx web/src/features/sessions/index.test.tsx
git commit -m "feat(web): real SessionsSidebar — recent-sessions list (replaces Phase-1 stub)"
```

---

## Task T56: Web — ⌘K `jump-to-sessions` + `search-sessions` commands

**Files:**
- Modify: `web/src/app/commands.ts`
- Modify: `web/src/app/commands.test.ts`

**Interfaces:**
- Consumes: `Command` type, existing `navCommands` array.
- Produces: two new entries in `navCommands`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/app/commands.test.ts`:
```typescript
  it('includes a jump-to-sessions command targeting /sessions', () => {
    const cmd = navCommands.find((c) => c.id === 'jump-to-sessions');
    expect(cmd?.label).toMatch(/session/i);
  });

  it('includes a search-sessions command also targeting /sessions', () => {
    const cmd = navCommands.find((c) => c.id === 'search-sessions');
    expect(cmd?.label).toMatch(/session/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/app/commands.test.ts`
Expected: FAIL — neither `jump-to-sessions` nor `search-sessions` exist yet.

- [ ] **Step 3: Add the two commands to `web/src/app/commands.ts`**

```typescript
  {
    id: 'jump-to-sessions',
    label: 'Jump to Sessions',
    run: (n) => n({ to: '/sessions' }),
  },
  // A true prefilled-query jump would need /sessions to accept a URL search
  // param and SessionsArea to read it on mount — real ⌘K completeness is
  // explicitly Phase 8 (this file's own comment, above). Kept as a second
  // plain nav command for now (spec §4.5's own hedge: "kept to the
  // 'navigation-command' shape").
  {
    id: 'search-sessions',
    label: 'Search Sessions',
    run: (n) => n({ to: '/sessions' }),
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/app/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
bun run lint:file -- web/src/app/commands.ts web/src/app/commands.test.ts
cd web && bun run typecheck && bun run test
cd ..
git add web/src/app/commands.ts web/src/app/commands.test.ts
git commit -m "feat(web): ⌘K jump-to-sessions + search-sessions nav commands (Phase 6)"
```

---

## Increment 5 — Notifications

## Task T57: Config — `AGENT_WEB_NOTIFY_POLL_MS` + `AGENT_WEB_NOTIFY_MIN_DURATION_MS`

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `tests/config/schema.test.ts`

**Interfaces:**
- Consumes: `CONFIG_SPEC`, `loadConfig` (existing).
- Produces: two new `ConfigEntry` rows.

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/schema.test.ts`:
```typescript
test('AGENT_WEB_NOTIFY_POLL_MS defaults to 5000', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_WEB_NOTIFY_POLL_MS).toBe(5_000);
  expect(sources.AGENT_WEB_NOTIFY_POLL_MS).toBe('default');
});
test('AGENT_WEB_NOTIFY_MIN_DURATION_MS defaults to 60000 and stays a large margin over the default poll interval (spec §7.2 invariant)', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_WEB_NOTIFY_MIN_DURATION_MS).toBe(60_000);
  expect(values.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number).toBeGreaterThan(
    (values.AGENT_WEB_NOTIFY_POLL_MS as number) * 10,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — both new `values.AGENT_WEB_NOTIFY_*` are `undefined`.

- [ ] **Step 3: Append the two entries to `CONFIG_SPEC` in `src/config/schema.ts`**

Add after the existing `AGENT_WEB_RECORD_IO` entry (end of the "Server / web BFF (Slice 30b)" group):
```typescript
  {
    env: 'AGENT_WEB_NOTIFY_POLL_MS',
    kind: 'number',
    def: 5_000,
    doc: 'How often the browser polls GET /api/runs for long-run completion notifications (server/main.ts injects this into the served page; web/src/features/notifications/use-run-notifications.ts reads it). Slice 30b Phase 6.',
  },
  {
    env: 'AGENT_WEB_NOTIFY_MIN_DURATION_MS',
    kind: 'number',
    def: 60_000,
    doc: "Minimum durationMs a completed Crew/Workflow/Agent run must have crossed before a completion notification fires. Spec §7.2's correctness argument depends on this staying well above AGENT_WEB_NOTIFY_POLL_MS (a run cannot both start and finish inside one poll interval, so it is always observed Running at least once before terminal). Slice 30b Phase 6.",
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS (both new + all pre-existing).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/config/schema.ts tests/config/schema.test.ts
bun test tests/config/schema.test.ts
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(config): AGENT_WEB_NOTIFY_POLL_MS + AGENT_WEB_NOTIFY_MIN_DURATION_MS (Phase 6)"
```

---

## Task T58: Server + web — thread notify config into the served page

**Files:**
- Modify: `src/server/main.ts` (`renderIndexHtml` + `startWebServer`)
- Modify: `tests/server/main.test.ts`
- Modify: `web/src/shared/contract/client.ts` (add `notifyConfig()`)
- Modify: `web/src/shared/contract/client.test.ts`

**Interfaces:**
- Consumes: `AGENT_WEB_NOTIFY_POLL_MS`/`AGENT_WEB_NOTIFY_MIN_DURATION_MS` (T57); the existing `window.__AGENT_TOKEN__` injection precedent (`renderIndexHtml`).
- Produces: `window.__AGENT_NOTIFY_POLL_MS__`/`window.__AGENT_NOTIFY_MIN_DURATION_MS__` injected alongside the token; `notifyConfig(): {pollMs, minDurationMs}` client helper (defaults 5000/60000 when absent — e.g. the Phase-1 stub page, or a component test with no injected globals).

- [ ] **Step 1: Write the failing server test**

Append to `tests/server/main.test.ts`:
```typescript
test('renderIndexHtml also injects the notify-poll config (defaults) alongside the token', () => {
  const html = renderIndexHtml('tok-777');
  expect(html).toContain('window.__AGENT_NOTIFY_POLL_MS__=5000');
  expect(html).toContain('window.__AGENT_NOTIFY_MIN_DURATION_MS__=60000');
});

test('renderIndexHtml threads an explicit notify config through', () => {
  const html = renderIndexHtml('tok-888', undefined, {
    pollMs: 1234,
    minDurationMs: 99_999,
  });
  expect(html).toContain('window.__AGENT_NOTIFY_POLL_MS__=1234');
  expect(html).toContain('window.__AGENT_NOTIFY_MIN_DURATION_MS__=99999');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/main.test.ts`
Expected: FAIL on the two new tests — `renderIndexHtml` doesn't accept a third argument and doesn't inject the notify globals.

- [ ] **Step 3: Extend `renderIndexHtml` and `startWebServer` in `src/server/main.ts`**

Replace the `renderIndexHtml` function:
```typescript
export type NotifyConfig = { pollMs: number; minDurationMs: number };

const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  pollMs: 5_000,
  minDurationMs: 60_000,
};

export function renderIndexHtml(
  token: string,
  distIndexHtml?: string,
  notify: NotifyConfig = DEFAULT_NOTIFY_CONFIG,
): string {
  // JSON.stringify does not escape `</`, so a token value could break out of
  // the <script> tag; escape `<` to a unicode escape before interpolating.
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  const tokenScript =
    `<script>window.__AGENT_TOKEN__=${safeToken};` +
    `window.__AGENT_NOTIFY_POLL_MS__=${JSON.stringify(notify.pollMs)};` +
    `window.__AGENT_NOTIFY_MIN_DURATION_MS__=${JSON.stringify(notify.minDurationMs)};</script>`;
  if (distIndexHtml !== undefined) {
    if (MODULE_SCRIPT_TAG.test(distIndexHtml)) {
      return distIndexHtml.replace(
        MODULE_SCRIPT_TAG,
        (match) => tokenScript + match,
      );
    }
    return distIndexHtml.replace(
      /<head(\s[^>]*)?>/i,
      (match) => match + tokenScript,
    );
  }
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>AI Local Agent</title>' +
    tokenScript +
    '</head><body><div id="root"></div></body></html>'
  );
}
```

Update the `startWebServer` call site (the `indexHtml:` line inside the `deps` object) to thread the live config through:
```typescript
    indexHtml: renderIndexHtml(token, distIndexHtml, {
      pollMs: cfg.AGENT_WEB_NOTIFY_POLL_MS as number,
      minDurationMs: cfg.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number,
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/main.test.ts`
Expected: PASS (all — the pre-existing token-only assertions still hold since the new script is additive to the same tag, not a replacement).

- [ ] **Step 5: Write the failing web test**

Append to `web/src/shared/contract/client.test.ts`:
```typescript
import { notifyConfig } from './client.ts';
```
```typescript
  it('reads the notify config from window, defaults when absent', () => {
    vi.stubGlobal('window', {});
    expect(notifyConfig()).toEqual({ pollMs: 5_000, minDurationMs: 60_000 });
    vi.stubGlobal('window', {
      __AGENT_NOTIFY_POLL_MS__: 1234,
      __AGENT_NOTIFY_MIN_DURATION_MS__: 99_999,
    });
    expect(notifyConfig()).toEqual({ pollMs: 1234, minDurationMs: 99_999 });
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- src/shared/contract/client.test.ts`
Expected: FAIL — `notifyConfig` is not exported from `client.ts`.

- [ ] **Step 7: Add `notifyConfig()` to `web/src/shared/contract/client.ts`**

Append after `sessionToken`:
```typescript
/** Web-only runtime config the BFF injects alongside the session token
 *  (Slice 30b Phase 6 — `server/main.ts`'s `renderIndexHtml`). Falls back to
 *  the same defaults `config/schema.ts` documents when unset (e.g. the
 *  Phase-1 stub page, or a component test with no injected globals). */
export function notifyConfig(): { pollMs: number; minDurationMs: number } {
  const w = globalThis as {
    window?: {
      __AGENT_NOTIFY_POLL_MS__?: number;
      __AGENT_NOTIFY_MIN_DURATION_MS__?: number;
    };
  };
  return {
    pollMs: w.window?.__AGENT_NOTIFY_POLL_MS__ ?? 5_000,
    minDurationMs: w.window?.__AGENT_NOTIFY_MIN_DURATION_MS__ ?? 60_000,
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && bun run test -- src/shared/contract/client.test.ts`
Expected: PASS.

- [ ] **Step 9: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/server/main.ts tests/server/main.test.ts
bun test tests/server/main.test.ts
bun run lint:file -- web/src/shared/contract/client.ts web/src/shared/contract/client.test.ts
cd web && bun run typecheck && bun run test
cd ..
git add src/server/main.ts tests/server/main.test.ts web/src/shared/contract/client.ts web/src/shared/contract/client.test.ts
git commit -m "feat(server,web): thread AGENT_WEB_NOTIFY_* config into the served page (Phase 6)"
```

---

## Task T59: Web — notification diff function + `use-run-notifications` hook [HARD — ultracode adversarial-verify]

> **Model tiering note:** the pure diff function's correctness is spec §7.2's "hard part" — the spec's own build-order explicitly flags this "ultracode Workflow, adversarial-verify." Do not merge this task on a single implementer pass without that adversarial-verify step (a Workflow-tool multi-agent fan-out + adversarial-verify, Opus/Fable-powered) confirming all four requirements in Step 4 below hold.

**Files:**
- Create: `web/src/features/notifications/notify-diff.ts`
- Test: `web/src/features/notifications/notify-diff.test.ts` (create)
- Create: `web/src/features/notifications/use-run-notifications.ts`
- Test: `web/src/features/notifications/use-run-notifications.test.ts` (create)

**Interfaces:**
- Consumes: `RunListItemDTO`, `RunListResponse`, `RunKind`, `RunLifecycle`, `RunListResponseSchema` (`@contracts`); `apiFetch`, `notifyConfig` (T58).
- Produces: `diffRunNotifications(prevSeen, items, opts): {nextSeen, toNotify}` (pure); `RunNotifyEvent`; `useRunNotifications(onNotify): void`.

- [ ] **Step 1: Write the failing pure-function tests**

`web/src/features/notifications/notify-diff.ts` scaffold (types only, so the test file below type-checks before Step 3 fills in the body):
```typescript
import type { RunListItemDTO } from '@contracts';
import { RunKind, RunLifecycle } from '@contracts';

export type RunNotifyEvent = {
  runId: string;
  kind: RunKind;
  durationMs: number;
};

export type NotifyDiffOptions = { baseline: boolean; minDurationMs: number };
export type NotifyDiffResult = {
  nextSeen: Map<string, RunLifecycle>;
  toNotify: RunNotifyEvent[];
};

export function diffRunNotifications(
  _prevSeen: Map<string, RunLifecycle>,
  _items: RunListItemDTO[],
  _opts: NotifyDiffOptions,
): NotifyDiffResult {
  throw new Error('not implemented');
}
```

`web/src/features/notifications/notify-diff.test.ts`:
```typescript
import type { RunListItemDTO } from '@contracts';
import { RunKind, RunLifecycle, RunOrigin } from '@contracts';
import { describe, expect, it } from 'vitest';
import { diffRunNotifications } from './notify-diff.ts';

function runItem(overrides: Partial<RunListItemDTO> = {}): RunListItemDTO {
  return {
    id: 'run-1',
    startMs: 0,
    durationMs: 0,
    outcome: 'answer',
    lifecycle: RunLifecycle.Running,
    origin: RunOrigin.Manual,
    kind: RunKind.Crew,
    models: [],
    degraded: false,
    spanCount: 0,
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

const MIN_DURATION_MS = 60_000;

describe('diffRunNotifications', () => {
  it('(a) the baseline poll never notifies, regardless of what it finds', () => {
    const items = [
      runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 999_999 }),
      runItem({ id: 'r2', lifecycle: RunLifecycle.Failed, durationMs: 999_999 }),
    ];
    const { toNotify, nextSeen } = diffRunNotifications(new Map(), items, {
      baseline: true,
      minDurationMs: MIN_DURATION_MS,
    });
    expect(toNotify).toEqual([]);
    expect(nextSeen.get('r1')).toBe(RunLifecycle.Done);
    expect(nextSeen.get('r2')).toBe(RunLifecycle.Failed);
  });

  it('fires exactly once for a Running->Done transition past the duration threshold', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([
      { runId: 'r1', kind: RunKind.Crew, durationMs: 90_000 },
    ]);
  });

  it('never fires when durationMs does not exceed the threshold', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 1_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('(d) never fires for a non-notifiable kind (Chat), even past the duration threshold', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [
        runItem({
          id: 'r1',
          kind: RunKind.Chat,
          lifecycle: RunLifecycle.Done,
          durationMs: 999_999,
        }),
      ],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('(b) a run already terminal at baseline never fires later — the check is Running->terminal specifically, not "terminal now"', () => {
    // Baseline poll sees the run already Done.
    const baselineResult = diffRunNotifications(
      new Map(),
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 999_999 })],
      { baseline: true, minDurationMs: MIN_DURATION_MS },
    );
    expect(baselineResult.toNotify).toEqual([]);
    // A later poll sees the SAME still-Done run — must not fire, because the
    // seen-map already recorded Done (never Running) for this run.
    const laterResult = diffRunNotifications(
      baselineResult.nextSeen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 999_999 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(laterResult.toNotify).toEqual([]);
  });

  it('a Queued/Paused->terminal transition that skips an observed Running state never fires', () => {
    const seen = new Map([['r1', RunLifecycle.Queued]]);
    const { toNotify } = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 999_999 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(toNotify).toEqual([]);
  });

  it('dedup falls out of the map: firing once updates the seen state to terminal, so a repeat poll of the same terminal run never re-fires', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const first = diffRunNotifications(
      seen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(first.toNotify).toHaveLength(1);
    const second = diffRunNotifications(
      first.nextSeen,
      [runItem({ id: 'r1', lifecycle: RunLifecycle.Done, durationMs: 90_000 })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(second.toNotify).toEqual([]);
  });

  it('(c) never drops or forgets a runId already in the map, even across an unrelated poll with a different set of items', () => {
    const seen = new Map([['r1', RunLifecycle.Running]]);
    const { nextSeen } = diffRunNotifications(
      seen,
      [runItem({ id: 'r2', lifecycle: RunLifecycle.Running })],
      { baseline: false, minDurationMs: MIN_DURATION_MS },
    );
    expect(nextSeen.get('r1')).toBe(RunLifecycle.Running);
    expect(nextSeen.get('r2')).toBe(RunLifecycle.Running);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/notifications/notify-diff.test.ts`
Expected: FAIL — the scaffold throws `not implemented`.

- [ ] **Step 3: Implement `diffRunNotifications` in `web/src/features/notifications/notify-diff.ts`**

Replace the scaffold body:
```typescript
import type { RunListItemDTO } from '@contracts';
import { RunKind, RunLifecycle } from '@contracts';

export type RunNotifyEvent = {
  runId: string;
  kind: RunKind;
  durationMs: number;
};

export type NotifyDiffOptions = { baseline: boolean; minDurationMs: number };
export type NotifyDiffResult = {
  nextSeen: Map<string, RunLifecycle>;
  toNotify: RunNotifyEvent[];
};

/** Long-running kinds worth notifying about — a chat turn never fires one
 *  (spec D11/§7.2 requirement d). Checked BEFORE the transition test. */
const NOTIFIABLE_KINDS: ReadonlySet<RunKind> = new Set([
  RunKind.Crew,
  RunKind.Workflow,
  RunKind.Agent,
]);

function isTerminal(lifecycle: RunLifecycle): boolean {
  return lifecycle === RunLifecycle.Done || lifecycle === RunLifecycle.Failed;
}

/**
 * Pure baseline-then-diff over one `GET /api/runs` poll tick (spec §7.2 —
 * the hard part). `prevSeen` is the hook's running `Map<runId, RunLifecycle>`
 * from the PREVIOUS tick; `opts.baseline` is true only for the very first
 * poll after mount, which seeds `nextSeen` but never notifies (requirement
 * a) — this is what keeps pre-existing terminal runs from firing on load.
 * Every later tick fires exactly once per run that was last recorded
 * `Running` and is now `Done`/`Failed` past `minDurationMs` (requirement b:
 * the guard is specifically "was Running", not "was non-terminal" or
 * "wasn't already terminal" — a run that skips straight from Queued/Paused
 * to terminal without ever being observed Running does NOT fire, matching
 * the spec's literal "last seen Running" wording). Once a run fires, its map
 * entry becomes the terminal lifecycle, which makes the `Running->terminal`
 * guard permanently false for it afterward — dedup falls out of the data
 * structure with no extra `Set` (requirement: no double-fire). The kind
 * filter is applied first (requirement d), and `nextSeen` always carries
 * forward every prior entry via the `new Map(prevSeen)` copy, even for a
 * runId absent from THIS tick's `items` — a hidden-tab caller (T59's hook)
 * must never construct `nextSeen` from `items` alone, or a run missing from
 * one page would be silently forgotten (requirement c is the hook's job to
 * uphold across ticks; this function's job is to never itself drop an
 * existing entry).
 */
export function diffRunNotifications(
  prevSeen: Map<string, RunLifecycle>,
  items: RunListItemDTO[],
  opts: NotifyDiffOptions,
): NotifyDiffResult {
  const nextSeen = new Map(prevSeen);
  const toNotify: RunNotifyEvent[] = [];

  for (const item of items) {
    if (!NOTIFIABLE_KINDS.has(item.kind)) continue;

    const prevLifecycle = prevSeen.get(item.id);
    const qualifies =
      !opts.baseline &&
      prevLifecycle === RunLifecycle.Running &&
      isTerminal(item.lifecycle) &&
      item.durationMs > opts.minDurationMs;

    if (qualifies) {
      toNotify.push({
        runId: item.id,
        kind: item.kind,
        durationMs: item.durationMs,
      });
    }
    nextSeen.set(item.id, item.lifecycle);
  }

  return { nextSeen, toNotify };
}
```

- [ ] **Step 4: Run tests to verify they pass — then adversarial-verify (HARD gate)**

Run: `cd web && bun run test -- src/features/notifications/notify-diff.test.ts`
Expected: PASS (all nine).

Before proceeding, dispatch an **ultracode Workflow adversarial-verify** pass over `notify-diff.ts` (Opus/Fable-powered per the model-tiering rule) checking specifically the four requirements spec §7.2 lists: (a) baseline never notifies; (b) the guard is `Running -> terminal` specifically; (c) a hidden-tab poll cadence change must never reset/drop the seen-map (this function never does — confirm the HOOK in Step 5 below doesn't either); (d) the kind filter runs before the transition check. Do not proceed to Step 5 until that pass reports "SOUND, could not refute" or any findings are fixed and re-verified.

- [ ] **Step 5: Write the failing hook test**

`web/src/features/notifications/use-run-notifications.ts` scaffold:
```typescript
import type { RunListResponse } from '@contracts';
import { RunListResponseSchema } from '@contracts';
import { useEffect, useRef } from 'react';
import { notifyConfig } from '../../shared/contract/client.ts';
import { apiFetch } from '../../shared/contract/client.ts';
import { diffRunNotifications, type RunNotifyEvent } from './notify-diff.ts';

export type NotifySink = (event: RunNotifyEvent) => void;

export function useRunNotifications(_onNotify: NotifySink): void {
  throw new Error('not implemented');
}
```

`web/src/features/notifications/use-run-notifications.test.ts`:
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunNotifications } from './use-run-notifications.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function runItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    startMs: 0,
    durationMs: 90_000,
    outcome: 'answer',
    lifecycle: 'running',
    origin: 'manual',
    kind: 'crew',
    models: [],
    degraded: false,
    spanCount: 0,
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

describe('useRunNotifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not poll (and does not notify) before one interval elapses', async () => {
    vi.stubGlobal('window', { __AGENT_NOTIFY_POLL_MS__: 10, __AGENT_NOTIFY_MIN_DURATION_MS__: 5 });
    const fetchMock = vi.fn(async () => jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const onNotify = vi.fn();
    renderHook(() => useRunNotifications(onNotify));
    // No synchronous fetch at mount — the first tick is scheduled, not immediate.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies once for a Running->Done transition observed across two ticks', async () => {
    vi.stubGlobal('window', {
      __AGENT_NOTIFY_POLL_MS__: 5,
      __AGENT_NOTIFY_MIN_DURATION_MS__: 1,
    });
    let tick = 0;
    const fetchMock = vi.fn(async () => {
      tick += 1;
      return jsonResponse({
        items: [
          runItem({ lifecycle: tick === 1 ? 'running' : 'done' }),
        ],
        total: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNotify = vi.fn();
    renderHook(() => useRunNotifications(onNotify));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2000,
    });
    await waitFor(() => expect(onNotify).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', kind: 'crew' }),
    );
  });

  it('a failed poll tick is swallowed silently — never throws, never crashes the effect', async () => {
    vi.stubGlobal('window', {
      __AGENT_NOTIFY_POLL_MS__: 5,
      __AGENT_NOTIFY_MIN_DURATION_MS__: 1,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const onNotify = vi.fn();
    expect(() => renderHook(() => useRunNotifications(onNotify))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onNotify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && bun run test -- src/features/notifications/use-run-notifications.test.ts`
Expected: FAIL — the scaffold throws `not implemented`.

- [ ] **Step 7: Implement the hook in `web/src/features/notifications/use-run-notifications.ts`**

```typescript
import type { RunListResponse } from '@contracts';
import { RunLifecycle, RunListResponseSchema } from '@contracts';
import { useEffect, useRef } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';
import { diffRunNotifications, type RunNotifyEvent } from './notify-diff.ts';

export type NotifySink = (event: RunNotifyEvent) => void;

/** How much slower the poll cadence backs off to while the tab is hidden —
 *  a multiplier on the configured `pollMs`, never a reset of the seen-map
 *  (spec §7.2 requirement c). */
const HIDDEN_BACKOFF_MULTIPLIER = 4;

/**
 * Polls `GET /api/runs` on `notifyConfig().pollMs`, baselining the seen-map
 * on the first tick (never notifies) and diffing every later tick via the
 * pure `diffRunNotifications` (spec D11/§7.2 — HARD, adversarially
 * verified in T59's own Step 4). Mounted ONCE at the AppShell level (T62),
 * alongside `CommandPalette`.
 *
 * Deliberately does NOT fire an immediate tick at mount — the first poll
 * fires only after one `pollMs` delay. This both matches "poll every N ms"
 * literally (the baseline poll IS the schedule's first tick, not a
 * zero-delay extra one) and, just as importantly, keeps this hook from
 * racing every OTHER component test's own `/api/runs`-adjacent fetch mock:
 * since `AppShell` mounts on every `renderAt(...)` call across the whole web
 * suite and the real default `pollMs` is 5000ms, no synchronous-style
 * vitest test ever lives long enough for this hook's first real tick to
 * fire unless it explicitly configures a tiny `pollMs` via the injected
 * `window.__AGENT_NOTIFY_POLL_MS__` global, as this file's own tests do.
 *
 * `onNotify` is captured in a ref, not a `useEffect` dependency — the poll
 * loop starts once at mount and keeps calling the LATEST `onNotify` without
 * ever tearing down and restarting the loop just because the caller passed
 * a fresh inline closure on some render.
 */
export function useRunNotifications(onNotify: NotifySink): void {
  const seenRef = useRef<Map<string, RunLifecycle>>(new Map());
  const baselinedRef = useRef(false);
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  useEffect(() => {
    let cancelled = false;
    const { pollMs, minDurationMs } = notifyConfig();
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const page = await apiFetch<RunListResponse>('/runs', {
          schema: RunListResponseSchema,
        });
        if (cancelled) return;
        const { nextSeen, toNotify } = diffRunNotifications(
          seenRef.current,
          page.items,
          { baseline: !baselinedRef.current, minDurationMs },
        );
        seenRef.current = nextSeen;
        baselinedRef.current = true;
        for (const event of toNotify) onNotifyRef.current(event);
      } catch {
        // A failed poll tick (network error, non-2xx, a schema mismatch) is
        // silently skipped — never crashes the app, never resets the
        // seen-map, just tries again next tick.
      }
    }

    function schedule() {
      const delay = document.hidden
        ? pollMs * HIDDEN_BACKOFF_MULTIPLIER
        : pollMs;
      timer = setTimeout(async () => {
        if (cancelled) return;
        await tick();
        if (!cancelled) schedule();
      }, delay);
    }

    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/notifications/use-run-notifications.test.ts`
Expected: PASS (all three).

- [ ] **Step 9: Gate + commit**

```bash
bun run lint:file -- web/src/features/notifications/notify-diff.ts web/src/features/notifications/notify-diff.test.ts web/src/features/notifications/use-run-notifications.ts web/src/features/notifications/use-run-notifications.test.ts
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/notifications/notify-diff.ts web/src/features/notifications/notify-diff.test.ts web/src/features/notifications/use-run-notifications.ts web/src/features/notifications/use-run-notifications.test.ts
git commit -m "feat(web): notification poll+diff — diffRunNotifications + useRunNotifications [HARD, adversarially verified] (Phase 6, spec §7.2)"
```

---

## Task T60: Web — `toast.tsx` (`ToastHost` + `useToast`)

**Files:**
- Create: `web/src/features/notifications/toast.tsx`
- Test: `web/src/features/notifications/toast.test.tsx` (create)

**Interfaces:**
- Consumes: nothing new (plain React context, mirroring `ThemeProvider`'s "throws outside provider" contract, `web/src/shared/design/theme.tsx`).
- Produces: `ToastHost`, `useToast(): {notify(text: string): void}`.

- [ ] **Step 1: Write the failing test**

`web/src/features/notifications/toast.test.tsx`:
```typescript
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastHost, useToast } from './toast.tsx';

function Trigger({ text }: { text: string }) {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify(text)}>
      fire
    </button>
  );
}

describe('ToastHost / useToast', () => {
  it('renders a toast after notify() is called', async () => {
    render(
      <ToastHost>
        <Trigger text="run finished" />
      </ToastHost>,
    );
    act(() => screen.getByRole('button', { name: 'fire' }).click());
    await waitFor(() =>
      expect(screen.getByText('run finished')).toBeInTheDocument(),
    );
  });

  it('supports multiple simultaneous toasts', async () => {
    render(
      <ToastHost>
        <Trigger text="first" />
        <Trigger text="second" />
      </ToastHost>,
    );
    const buttons = screen.getAllByRole('button', { name: 'fire' });
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument();
      expect(screen.getByText('second')).toBeInTheDocument();
    });
  });

  it('useToast throws when used outside ToastHost', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/useToast must be used within ToastHost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/features/notifications/toast.test.tsx`
Expected: FAIL — `toast.tsx` doesn't exist yet.

- [ ] **Step 3: Create `web/src/features/notifications/toast.tsx`**

```typescript
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

export type ToastMessage = { id: string; text: string };
type ToastContextValue = { notify: (text: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_TIMEOUT_MS = 6_000;

/** A minimal always-on toast host, mounted once at the AppShell level (spec
 *  D11 — "in-app toast + optional browser Notification API"): any feature
 *  (the notification poll, T62; future features) calls `useToast().notify`. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  const notify = useCallback((text: string) => {
    const id = `toast-${counter.current++}`;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TIMEOUT_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        data-testid="toast-host"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className="pointer-events-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] shadow-lg"
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws if used outside `ToastHost` — a programmer error, not a
 *  degrade-gracefully case (mirrors `useTheme`'s context-required contract,
 *  `web/src/shared/design/theme.tsx`). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastHost');
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/notifications/toast.test.tsx`
Expected: PASS (all three).

- [ ] **Step 5: Gate + commit**

```bash
bun run lint:file -- web/src/features/notifications/toast.tsx web/src/features/notifications/toast.test.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/notifications/toast.tsx web/src/features/notifications/toast.test.tsx
git commit -m "feat(web): ToastHost + useToast — the always-on notification fallback (Phase 6)"
```

---

## Task T61: Web — Settings toggle + `isOsNotifyEnabled` (Notification API opt-in)

**Files:**
- Modify: `web/src/features/settings/index.tsx` (replace the Phase-1 placeholder)
- Test: `web/src/features/settings/index.test.tsx` (create)

**Interfaces:**
- Consumes: `localStorage` (already mocked in-memory by `web/src/test/setup.ts` for every test); the global `Notification` API (guarded — jsdom/happy-dom has no real implementation, tests stub it).
- Produces: `SettingsArea` (real toggle, replacing the placeholder); `isOsNotifyEnabled(): boolean` (exported for T62 to consume).

- [ ] **Step 1: Write the failing test**

`web/src/features/settings/index.test.tsx`:
```typescript
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { isOsNotifyEnabled } from './index.tsx';

function stubNotification(permission: NotificationPermission, requestResult: NotificationPermission = permission) {
  const NotificationMock = {
    permission,
    requestPermission: vi.fn().mockResolvedValue(requestResult),
  };
  vi.stubGlobal('Notification', NotificationMock);
  return NotificationMock;
}

describe('SettingsArea', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the "Enable OS notifications" toggle, initially off', async () => {
    stubNotification('default');
    renderAt('/settings');
    expect(
      await screen.findByTestId('notify-os-toggle'),
    ).toHaveTextContent('Enable OS notifications');
    expect(isOsNotifyEnabled()).toBe(false);
  });

  it('requests permission and turns on when granted', async () => {
    const mock = stubNotification('default', 'granted');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(mock.requestPermission).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('OS notifications: on'),
    ).toBeInTheDocument();
    expect(isOsNotifyEnabled()).toBe(true);
  });

  it('stays off when permission is denied', async () => {
    stubNotification('default', 'denied');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(
      await screen.findByText('Enable OS notifications'),
    ).toBeInTheDocument();
    expect(isOsNotifyEnabled()).toBe(false);
  });

  it('toggles back off when clicked again while already on', async () => {
    stubNotification('granted', 'granted');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(await screen.findByText('OS notifications: on')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notify-os-toggle'));
    expect(
      await screen.findByText('Enable OS notifications'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/settings/index.test.tsx`
Expected: FAIL — `isOsNotifyEnabled` doesn't exist; the placeholder renders "Streaming chat lands in Phase 2.", not the toggle.

- [ ] **Step 3: Replace `web/src/features/settings/index.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';

const STORAGE_KEY = 'agent.notifyOsEnabled';

function storedPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Read by `use-run-notifications`'s AppShell wiring (T62) to decide whether
 *  a qualifying notification should ALSO fire a browser `Notification`, on
 *  top of the always-on in-app toast. */
export function isOsNotifyEnabled(): boolean {
  return storedPreference();
}

/** Settings' first real control (replacing the Phase-1 placeholder): an
 *  opt-in toggle for browser `Notification` API alerts, layered on top of
 *  the always-on in-app toast (spec D11 — toast is the fallback, this is
 *  additive). */
export function SettingsArea() {
  const [enabled, setEnabled] = useState(storedPreference);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore persistence failure — the toggle still applies for the session
    }
  }, [enabled]);

  async function handleToggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return; // user declined — stay off
    } else if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
    ) {
      return; // previously denied outright — nothing to prompt again
    }
    setEnabled(true);
  }

  return (
    <section data-testid="area-settings" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Settings</h1>
      <div className="mt-4 flex items-center gap-3">
        <Button
          data-testid="notify-os-toggle"
          variant={enabled ? 'accent' : 'default'}
          onClick={handleToggle}
        >
          {enabled ? 'OS notifications: on' : 'Enable OS notifications'}
        </Button>
        {permission === 'denied' && (
          <span className="text-xs text-[var(--color-muted)]">
            Browser permission was denied — enable it in your browser's site
            settings.
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        In-app toasts always fire; OS notifications are an optional extra for
        when this tab isn't focused.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/settings/index.test.tsx`
Expected: PASS (all four).

- [ ] **Step 5: Gate + commit**

```bash
bun run lint:file -- web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
git commit -m "feat(web): Settings — OS-notification opt-in toggle (Phase 6, replaces Phase-1 placeholder)"
```

---

## Task T62: Web — mount `useRunNotifications` + `ToastHost` in `AppShell`

**Files:**
- Modify: `web/src/app/app-shell.tsx`
- Test: `web/src/app/app-shell.test.tsx` (extend)

**Interfaces:**
- Consumes: `ToastHost`/`useToast` (T60), `useRunNotifications` (T59), `isOsNotifyEnabled` (T61).
- Produces: every route now renders under a mounted `ToastHost`; a qualifying run-completion notification shows an in-app toast, plus a browser `Notification` when the user has opted in and permission is granted.

- [ ] **Step 1: Write the failing test**

Append to `web/src/app/app-shell.test.tsx`:
```typescript
  it('mounts a ToastHost so useToast works anywhere under AppShell', async () => {
    renderAt('/');
    expect(await screen.findByTestId('toast-host')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/app/app-shell.test.tsx`
Expected: FAIL — no `toast-host` testid rendered yet.

- [ ] **Step 3: Wire `ToastHost` + `useRunNotifications` into `web/src/app/app-shell.tsx`**

```typescript
import { Link, Outlet } from '@tanstack/react-router';
import { useCallback } from 'react';
import { isOsNotifyEnabled } from '../features/settings/index.tsx';
import { SessionsSidebar } from '../features/sessions/index.tsx';
import type { RunNotifyEvent } from '../features/notifications/notify-diff.ts';
import { ToastHost, useToast } from '../features/notifications/toast.tsx';
import { useRunNotifications } from '../features/notifications/use-run-notifications.ts';
import { useTheme } from '../shared/design/theme.tsx';
import { Button } from '../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../shared/ui/error-boundary.tsx';
import { CommandPalette } from './command-palette.tsx';

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Chat' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/crews', label: 'Crews' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/builders', label: 'Builders' },
  { to: '/runs', label: 'Runs' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];

/** Public entry: mounts the `ToastHost` provider, then renders the real
 *  shell as a child so `AppShellInner` can call `useToast()` (a component
 *  can't consume a context provider it itself renders). */
export function AppShell() {
  return (
    <ToastHost>
      <AppShellInner />
    </ToastHost>
  );
}

function formatRunNotify(event: RunNotifyEvent): string {
  const seconds = Math.round(event.durationMs / 1000);
  return `${event.kind} run finished (${seconds}s)`;
}

function AppShellInner() {
  const { theme, toggle } = useTheme();
  const { notify } = useToast();

  const onRunNotify = useCallback(
    (event: RunNotifyEvent) => {
      const text = formatRunNotify(event);
      notify(text);
      if (
        isOsNotifyEnabled() &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification('Run finished', { body: text });
      }
    },
    [notify],
  );
  useRunNotifications(onRunNotify);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-2">
        <span className="font-mono text-sm text-[var(--color-accent)]">
          ◇ local-agents
        </span>
        <nav className="flex gap-3" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="font-mono text-sm text-[var(--color-muted)] [&.active]:text-[var(--color-fg)]"
              activeOptions={{ exact: n.to === '/' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <kbd className="rounded border border-[var(--color-border)] px-1.5 text-xs text-[var(--color-muted)]">
            ⌘K
          </kbd>
          <Button onClick={toggle} aria-label={`theme: ${theme}`}>
            {theme === 'dark' ? '☾' : '☀'}
          </Button>
        </div>
      </header>
      <CommandPalette />
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar />
        <main className="min-w-0 flex-1 overflow-auto">
          <RegionErrorBoundary region="Workspace">
            <Outlet />
          </RegionErrorBoundary>
        </main>
      </div>
    </div>
  );
}
```

(Note: the NAV array above already reflects T53's Sessions entry — if T53 landed first, this step is a no-op diff on that array; only add it here if for some reason it's still missing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/app/app-shell.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Run the FULL web suite — this touches the shared AppShell every test renders through**

Run: `cd web && bun run test`
Expected: PASS across the board. If any pre-existing test now fails because it asserts on `fetch` call count/order and races the (delayed, per T59) notification poll, the fix is scoping that specific test's mock, never loosening T59/T61's own assertions.

- [ ] **Step 6: Gate + commit**

```bash
bun run lint:file -- web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx
cd web && bun run typecheck && bun run test
cd ..
git add web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx
git commit -m "feat(web): mount ToastHost + useRunNotifications in AppShell (Phase 6 notifications, complete)"
```

---

## Increment 6 — Docs + live-verify + land

## Task T63: `docs/architecture.md` — new §"Persistence — Sessions + chat recall"

No TDD here — the "test" is `bun run docs:check` passing green. Scoped to the WHOLE Phase-6 milestone (Increments 1–6), since this is the first docs pass covering Part A's work too — read the actual Increment 1–3 diffs (not just this plan's assumptions) before writing, so the architecture-doc claims match the REAL merged code, not Part B's inferred shapes.

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a new §3g sequence diagram alongside §3a–3f**

Insert after §3f ("Builders + Library — web flows…") and before "## 4. Resource model", titled `### 3g. Persistence — Sessions + chat recall (browser REST, Slice 30b Phase 6)`. Cover: `POST /api/chat`'s new persist-at-start (user message)/persist-at-completion (assistant message) sequence (D3/D4, Increment 2); the `injectRecall` one-liner in `runChatSession` (D5, Increment 3) and the fire-and-forget `rememberOnce` auto-ingest into the `chat` memory space (D6); `GET/PATCH/DELETE /api/sessions`(`/:id`) → `SessionStore`; `GET /api/sessions/:id/export` → raw-store Markdown render (D8, T51); an explicit note that the notification poll (T59/T62) is a **web-only** concern riding the already-documented `GET /api/runs` with zero server-side change.

- [ ] **Step 2: Module map (§2) — new `src/session/` entry**

Add an entry mirroring `src/memory/`'s existing module-map block (§11's "Module map additions"):
```
session/ (migrations, store)
  ← server/chat/handler.ts   (upsertSession, appendMessage at turn boundaries)
  ← server/sessions/{list,detail,rename,delete,export}.ts (read/mutate/export)
  → db/migrate.ts             (shared migration runner, same as memory/sqlite-store.ts)
```
Adjust the exact consumer file list to match what Increment 1–2 actually named its handler files (read `src/server/sessions/` for the real filenames before finalizing this block).

- [ ] **Step 3: §11 (Memory/RAG) — recall/auto-ingest note**

Under the existing §11, add a short note: `injectRecall` (`memory/recall-tool.ts`) now has its first real caller (`runChatSession`, D5) — space-wide recall, no namespace filter; `rememberOnce` (D6) is a new additive method on the returned `MemoryStore` closure, reusing `SqliteStore`'s existing `seenDoc`/`recordDoc` dedup guard against a `chat:${sessionId}:${assistantMessageId}` source id.

- [ ] **Step 4: §7 (Observability) — telemetry note**

Add: `memory.recall` (already existed) is reused unchanged for chat's `injectRecall` call; a new `memory.remember` span (attributes: `space`, `namespace`, `skipped`) covers `rememberOnce`, landing in the SAME chat turn's trace (no ephemeral run-minting needed, unlike Phase 5's standalone Memory-tab routes) since it fires from inside `handleChat`'s already-open `ui.stream` span. `SessionStore`'s raw SQLite writes get no new spans (synchronous, sub-millisecond local IO, same treatment as `run-store.ts`). The notification poll emits NO new server telemetry — every tick is just another `GET /api/runs` request under the existing `withServerRequestSpan`.

- [ ] **Step 5: Verify + commit**

```bash
bun run docs:check
git add docs/architecture.md
git commit -m "docs(architecture): Slice 30b Phase 6 — §3g persistence + session module map + telemetry notes"
```

---

## Task T64: `README.md` + `docs/ROADMAP.md` — status/table/paragraph/gap-table updates

No TDD — same `bun run docs:check` gate. Scoped to the whole Phase-6 milestone.

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: `README.md`**
  - Status blockquote: extend the Slice 30b line to state Phase 6 (persistence — SessionStore, chat recall + auto-ingest, Sessions UI, long-run notifications) has landed, alongside Phases 1/1b/2/3/4/5. Phases 7 (voice) and 8 (polish/a11y/live-verify) remain — the 30b capability itself stays 🟡.
  - Slice-status table: add the Slice 30b Phase 6 row (✅ Done) with a one-line capability summary + a `docs/architecture.md` §3g anchor, appended to the existing row (matching the Phase 2/3/4/5 append pattern already established there).
  - Feature paragraph: add a "Persistence + product (web UI — Slice 30b Phase 6)" paragraph — chat now survives a reload (client-minted session id, idempotent upsert, persist-at-start/persist-at-completion); recall reads from a dedicated `chat` memory space and every completed turn writes itself back in (auto-ingest); a real Sessions history (list/detail/rename/delete/Markdown export); client-side long-run completion notifications (toast + optional OS `Notification`). State the honest caveats: `parentMessageId` branch/fork threading is written but unused (Slice 41); no JSON export; no server-push/global SSE event bus; no session retention/GC; the CLI gets the recall READ benefit only, no CLI-side session persistence.
  - "Next" line: move the pointer from "Slice 30b Phase 6" to "Slice 30b Phase 7" (voice — capability still NOT flipped, Phase 8 remains).

- [ ] **Step 2: `docs/ROADMAP.md`**
  - Gap table (the `TUI / local web UI` row): extend the "in progress" prose to include "+ 6 (Persistence: SessionStore, chat recall/auto-ingest, Sessions UI, notifications)."
  - Slice table (`30b` row): append the Phase-6 summary sentence to the existing multi-phase cell; bump the status marker to `🚧 In progress — Phases 1, 1b, 2, 3, 4, 5 & 6 landed`.
  - Recommended-sequence table: add a new bullet after the existing Phase 5 bullet (mirroring its exact style/format — see the Phase 2/3/5 bullets already there), titled `Phase 6 — Persistence + product` — ✅ **shipped (fill in the real merge date)**. Summarize: client-minted `sessionId` + idempotent upsert (D2); persist-at-start/persist-at-completion (D3/D4); `injectRecall` wired into `runChatSession` + `rememberOnce` auto-ingest into the `chat` space (D5/D6); the Sessions UI (list/detail/rename/delete/export, D8/D9/D10); the notification poll+diff (D11, §7.2, adversarially verified); regenerate/edit-resend stay linear this phase (D12, `parentMessageId` reserved for Slice 41). Link the spec + this plan + the ledger section, same pattern as the Phase-5 bullet.
  - "Next (product line)" row: update to point at Phase 7 (voice) onward.
  - The memory ANN/hybrid-FTS-fusion gap row stays **unflipped** — pre-existing, unaffected by this phase (per the spec's own forward-items §9).

- [ ] **Step 3: Verify + commit**

```bash
bun run docs:check
git add README.md docs/ROADMAP.md
git commit -m "docs(readme,roadmap): Slice 30b Phase 6 — status line, slice tables, recommended-sequence entry"
```

---

## Task T65: SDD ledger — `.superpowers/sdd/progress.md` §"SLICE 30b — PHASE 6"

**Files:**
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Append a new section header**

Mirroring the existing `## SLICE 30b — PHASE 5` header format exactly:
```markdown
## SLICE 30b — PHASE 6 (Persistence + Product) — branch slice-30b-phase6-persistence, base ad495cf

Spec: docs/superpowers/specs/2026-07-16-slice-30b-phase6-persistence-design.md
Plan (Part A, Increments 1-3): docs/superpowers/plans/<Part-A's-actual-filename>.md
Plan (Part B, Increments 4-6): docs/superpowers/plans/_phase6-part-b-incr4-6.md
```

- [ ] **Step 2: Per-task recovery lines**

Per-task `- [ ]`/`- ✅` commit-reference lines (one per task T1…T67, across both Part A and Part B, plus the fix-wave/live-verify/landing entries) are filled in DURING execution, not written now — mirror the exact bullet format the Phase-5 section uses for its own per-task lines (read that section for the literal format before appending).

- [ ] **Step 3: Verify + commit**

```bash
bun run docs:check
git add .superpowers/sdd/progress.md
git commit -m "chore(sdd): Slice 30b Phase 6 ledger — section header + recovery-map scaffold"
```

---

## Task T66: Live-verify checklist (real Ollama, whole Phase-6 milestone)

No TDD — a manual checklist run against `bun run web` with a real Ollama installation, per the standing Live-verify-before-merge gate. Covers all 6 increments (Part A + Part B) since mocks/unit tests/reviews miss real integration bugs.

**Files:** none (this task produces findings, not code — any defect found feeds a fix wave before landing).

- [ ] **Step 1: Boot the real server** — `bun run web`, open the browser at the printed URL + token.

- [ ] **Step 2: Persist across reload (Increment 2)** — start a fresh chat, send 2–3 turns, then hard-reload the page. Confirm the FULL transcript reappears (not just the current tab's in-memory state) — this is the whole point of `GET /api/sessions/:id` rehydrate on mount. Confirm the session id survives the reload (same `localStorage` key).

- [ ] **Step 3: Recall surfaces a prior turn (Increment 3)** — in session A, mention a distinctive fact ("my favorite color is chartreuse"). Start a NEW chat (session B) and ask a question that should recall it ("what's my favorite color?"). Confirm the answer reflects the auto-ingested prior turn — this proves `injectRecall`'s space-wide (cross-session) recall actually fires. Confirm the CLI (`bun run src/cli/chat.ts "what's my favorite color?"`) ALSO recalls it (READ-only wiring, D5) but does NOT itself get written back into the `chat` space (no session to namespace by).

- [ ] **Step 4: Sessions UI (Increment 4)** — open `/sessions`: confirm the two sessions from Steps 2–3 both appear, searchable by a keyword from their content. Open one, confirm the transcript renders. Rename it, confirm the new title persists after a reload of `/sessions`. Click Export, confirm a `.md` file downloads with the full transcript. Delete the OTHER session, confirm it disappears from the list and the sidebar. Confirm the left-rail `SessionsSidebar` shows the remaining session.

- [ ] **Step 5: Notifications (Increment 5)** — launch a real crew or workflow run (from `/crews` or `/workflows`) that will run long enough to exceed `AGENT_WEB_NOTIFY_MIN_DURATION_MS` (60s default — pick/construct a task that takes at least that long, or temporarily lower `AGENT_WEB_NOTIFY_MIN_DURATION_MS`/`AGENT_WEB_NOTIFY_POLL_MS` via env for this check only). Navigate away from `/runs` to another tab in the app while it's running. Confirm an in-app toast appears once the run completes. If the Settings toggle was enabled + permission granted, confirm a real OS-level `Notification` also appeared. Confirm NO notification fires for a run that completes in under the duration threshold, and none fires for pre-existing already-finished runs visible on first load (the baseline-poll guarantee).

- [ ] **Step 6: Record findings** — note any live-only defects found (integration bugs mocks/unit tests can't catch) for the fix wave in the whole-branch review below; do not silently work around them.

---

## Task T67: Regenerate the docs-snapshot Artifact (controller-owned)

Not a code task — the Artifact is a claude.ai-hosted page, not a repo file, so tooling can only remind; regenerating it is a deliberate step the controller (whoever holds the session at slice closeout) performs directly, per `reference-artifact-regen-mechanics`.

- [ ] **Step 1:** Locate the existing docs-snapshot Artifact URL (`action: "list"` if not already in hand from a prior session).
- [ ] **Step 2:** Add new nodes: `src/session/` (SessionStore), `src/server/sessions/*` (list/detail/rename/delete/export), `web/src/features/sessions/*` (sidebar/list/detail), `web/src/features/notifications/*` (diff/hook/toast). Add new edges: `chat handler → SessionStore` (persist), `runChatSession → MemoryStore` (recall + auto-ingest, labeled `chat` space), a dashed/annotated "web-only, no server change" edge or note for the notification poll over the existing `GET /api/runs` node.
- [ ] **Step 3:** Bump the footer's slice count and real test count (read the actual `bun test` + `cd web && bun run test` pass counts post-merge, never a stale/estimated number).
- [ ] **Step 4:** Validate with `node --check` + referential integrity (every edge's endpoints resolve to a real node) before republishing, per the established mechanics doc.

---

## Final gate & landing

1. **Whole-branch fan-out review** — 2–3 reviewers in parallel (Opus/Fable per the model-tiering rule), each over the full `main...HEAD` diff spanning Increments 1–6 (Part A + Part B together): **correctness** (the turn-boundary persistence contract §7.1 — Part A's territory but re-verify Part B's export/rehydrate reads don't assume a stale shape; the notification-diff contract §7.2 — T59, already adversarially verified once, re-confirm against the merged whole); **security** (every new `/api/sessions/*` route rides the existing perimeter/token guard; the export route's 404 doesn't leak whether a session id merely doesn't exist vs. is malformed; `SessionStore`'s SQL is parameterized, no raw string interpolation of `search`/`title`); **docs accuracy** (T63/T64/T65's claims against the REAL diff, the same bar that caught 6 wrong edges in the Slice-9 audit).
2. **Live-verify** (T66, already run) — fold any findings into the fix wave above; re-run the affected checklist steps after fixes land.
3. **Partial-slice land** — merge `slice-30b-phase6-persistence` `--no-ff` into `main` + push, with `README.md` + `docs/ROADMAP.md` + `.superpowers/sdd/progress.md` all in the same push as `docs/architecture.md` (the pre-push slice-landing gate requires all four together). The 30b capability is **NOT** flipped in the ROADMAP gap table — Phases 7 (voice) and 8 (polish/a11y/live-verify) remain.
4. **Regenerate the docs-snapshot Artifact** (T67, already described) — perform it as the closing action, after the merge/push lands, so the footer's test count reflects the merged `main`.
