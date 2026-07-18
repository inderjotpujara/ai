## Task 7: `appendMessage` / `getMessages` (idempotent append, ordered read) + the deferred cascade-delete test

**Files:**
- Modify: `src/session/store.ts` (add `StoredMessage` type + two methods)
- Modify: `tests/session/store.test.ts` (append a `describe` block; replace Task 6's deferred-cascade `NOTE` comment with a real test)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export type StoredMessage = { id: string; sessionId: string; parentMessageId: string | undefined; role: string; parts: unknown; createdAt: number; degraded: boolean | undefined }` — the RAW stored shape (`parts` un-decoded to whatever JSON the caller originally passed), distinct from the wire `ChatMessageDTO` (which flattens to a `text` string) — that projection is a later increment's job (server layer).
  - `appendMessage(sessionId: string, msg: { id: string; role: string; parts: unknown; parentMessageId?: string; degraded?: boolean }, at: number): void` — `INSERT OR IGNORE` on `msg.id` (a retried/duplicate POST for the same message id is a safe no-op, spec D4/§7.1(d)); also touches `sessions.updated_at`/`last_message_at` to `at` so `listSessions`'s sort key (Task 8) advances.
  - `getMessages(sessionId: string): StoredMessage[]` — ordered by `created_at ASC` (oldest first, matching transcript reading order).

**Design note on `run_id` (flag for the Increment-2 controller):** Spec §4.3 says `appendMessage` "touches `sessions.updated_at`/`last_message_at`/`run_id`", but the exact signature this plan implements (locked by the increment-1 task brief) carries no `runId` field on `msg`. This task's `appendMessage` therefore updates `updated_at`/`last_message_at` only and leaves `run_id` untouched (it stays whatever `upsertSession` left it — always `NULL` in Increment 1, since `upsertSession` never sets it either). Increment 2 (chat wiring) will need to decide how `sessions.run_id` actually gets populated — e.g. extend `appendMessage`'s `msg` type with an optional `runId`, or add a small dedicated `setRunId(id, runId)` method — since nothing in this increment's locked signature carries that data. This is called out again in the final report to the controller.

- [ ] **Step 1: Write the failing tests**

First, replace the trailing `NOTE` comment inside the `describe('renameSession / deleteSession', ...)` block (added in Task 6) —
```typescript
  // NOTE: the full cascade assertion (messages also gone) is added for real
  // in Task 7 Step 3, once appendMessage/getMessages exist — this task only
  // proves the session-row half of the delete.
```
— with a real test:
```typescript
  test('deleteSession cascades — messages are gone too', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_000,
    );
    expect(store.getMessages('s1')).toHaveLength(1);

    store.deleteSession('s1');

    expect(store.getSession('s1')).toBeUndefined();
    expect(store.getMessages('s1')).toHaveLength(0);
  });
```

Then append a new `describe` block after `describe('renameSession / deleteSession', ...)`:
```typescript
describe('appendMessage / getMessages', () => {
  beforeEach(() => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
  });

  test('appendMessage stores a message and touches session activity timestamps', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_500,
    );
    const session = store.getSession('s1');
    expect(session?.updatedAt).toBe(1_500);
    expect(session?.lastMessageAt).toBe(1_500);

    const messages = store.getMessages('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('m1');
    expect(messages[0]?.sessionId).toBe('s1');
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'hi' }]);
    expect(messages[0]?.parentMessageId).toBeUndefined();
    expect(messages[0]?.degraded).toBeUndefined();
  });

  test('appendMessage is idempotent — the same message id posted twice yields one row', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      1_500,
    );
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi (retry)' }] },
      1_600,
    );

    const messages = store.getMessages('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'hi' }]); // first write wins
  });

  test('appendMessage records parentMessageId and degraded when provided', () => {
    store.appendMessage(
      's1',
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'a' }],
        parentMessageId: 'm0',
        degraded: true,
      },
      1_000,
    );
    const messages = store.getMessages('s1');
    expect(messages[0]?.parentMessageId).toBe('m0');
    expect(messages[0]?.degraded).toBe(true);
  });

  test('appendMessage with degraded explicitly false round-trips false, not undefined', () => {
    store.appendMessage(
      's1',
      { id: 'm1', role: 'assistant', parts: [], degraded: false },
      1_000,
    );
    expect(store.getMessages('s1')[0]?.degraded).toBe(false);
  });

  test('getMessages orders by created_at ascending regardless of insert order', () => {
    store.appendMessage(
      's1',
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'second' }] },
      2_000,
    );
    store.appendMessage(
      's1',
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      1_000,
    );
    const messages = store.getMessages('s1');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  test('getMessages on a session with no messages returns an empty array', () => {
    expect(store.getMessages('s1')).toEqual([]);
  });

  test('getMessages is session-scoped — a second session\'s messages never leak in', () => {
    store.upsertSession('s2', { defaultTitle: 'Other chat', at: 1_000 });
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 1_000);
    store.appendMessage('s2', { id: 'm2', role: 'user', parts: [] }, 1_000);
    expect(store.getMessages('s1').map((m) => m.id)).toEqual(['m1']);
    expect(store.getMessages('s2').map((m) => m.id)).toEqual(['m2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `store.appendMessage`/`store.getMessages` are not functions yet; the new cascade-delete test also fails for the same reason (all other, previously-passing tests still PASS).

- [ ] **Step 3: Add `StoredMessage` + `appendMessage`/`getMessages` to `src/session/store.ts`**

Add the `StoredMessage` type and its raw/decode helper near the top of the file, right after the existing `SessionRowRaw`/`toSessionRow` block:
```typescript
/** A stored chat message, RAW (`parts` un-decoded to whatever JSON the
 *  caller passed) — distinct from the wire `ChatMessageDTO` (which flattens
 *  to a `text` string); that projection is the server layer's job, not
 *  this store's. */
export type StoredMessage = {
  id: string;
  sessionId: string;
  parentMessageId: string | undefined;
  role: string;
  parts: unknown;
  createdAt: number;
  degraded: boolean | undefined;
};

type MessageRowRaw = {
  id: string;
  session_id: string;
  parent_message_id: string | null;
  role: string;
  parts: string;
  created_at: number;
  degraded: number | null;
};

function toStoredMessage(r: MessageRowRaw): StoredMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    parentMessageId: r.parent_message_id ?? undefined,
    role: r.role,
    parts: JSON.parse(r.parts) as unknown,
    createdAt: r.created_at,
    degraded: r.degraded === null ? undefined : r.degraded === 1,
  };
}
```

Then add the two functions after `deleteSession` (before the `return { ... }` block):
```typescript
  function appendMessage(
    sessionId: string,
    msg: {
      id: string;
      role: string;
      parts: unknown;
      parentMessageId?: string;
      degraded?: boolean;
    },
    at: number,
  ): void {
    // INSERT OR IGNORE on the message id: a retried/duplicate POST for the
    // SAME message id is a safe no-op (spec D4/D6/§7.1(d)).
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
    // Touch activity timestamps so listSessions's sort key advances.
    // run_id is deliberately NOT touched here — this signature carries no
    // runId; see this task's design note.
    db.run(
      'UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?',
      [at, at, sessionId],
    );
  }

  function getMessages(sessionId: string): StoredMessage[] {
    const rows = db
      .query(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      )
      .all(sessionId) as MessageRowRaw[];
    return rows.map(toStoredMessage);
  }
```
Update the returned object to:
```typescript
  return {
    upsertSession,
    getSession,
    renameSession,
    deleteSession,
    appendMessage,
    getMessages,
    close: (): void => db.close(),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: PASS (all 17 tests — 5 from Task 5 + 5 from Task 6 + 7 new in this task).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/store.ts tests/session/store.test.ts
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): add appendMessage/getMessages with idempotent insert (Phase 6 Incr 1)"
```

---

