## Task 8: `listSessions` — SQL keyset cursor pagination (search + `COALESCE` sort + id tie-break)

**Files:**
- Modify: `src/session/store.ts` (add cursor encode/decode helpers, `listSessions`, wire into the returned object; add a `SessionListItemDTO` import from contracts)
- Modify: `tests/session/store.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `SessionListItemDTO` (Task 1, `src/contracts/index.ts`).
- Produces: `listSessions(q: { search?: string; cursor?: string; limit: number }): { items: SessionListItemDTO[]; nextCursor?: string; total: number }`. Sort key is `COALESCE(last_message_at, created_at)` descending, `id` ascending tie-break (spec D10) — matches `GET /api/runs`'s opaque `base64url(sortKey:id)` cursor CONTRACT with the client (`src/server/runs/list.ts:22-33`'s `encodeCursor`/`decodeCursorId`), but the sort/filter/page happens in SQL, not an in-process array, since sessions live in a real table (spec D10's explicit authorized deviation on internals only). `search` matches case-insensitively against `title` via `LIKE`. `total` reflects the post-search-filter row count (not the page size) — same semantics as `RunListResponseSchema.total`.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `tests/session/store.test.ts`, after `describe('appendMessage / getMessages', ...)`:
```typescript
describe('listSessions', () => {
  test('an empty store returns an empty page with total 0', () => {
    const page = store.listSessions({ limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextCursor).toBeUndefined();
  });

  test('sorts by COALESCE(last_message_at, created_at) desc — a session with a later message outranks an older-created session with no messages', () => {
    store.upsertSession('s1', { defaultTitle: 'One', at: 1_000 });
    store.upsertSession('s2', { defaultTitle: 'Two', at: 2_000 });
    store.upsertSession('s3', { defaultTitle: 'Three', at: 3_000 });
    store.appendMessage('s1', { id: 'm1', role: 'user', parts: [] }, 5_000);

    const page = store.listSessions({ limit: 10 });
    expect(page.items.map((i) => i.id)).toEqual(['s1', 's3', 's2']);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeUndefined();
  });

  test('ties on the sort key break by id ascending', () => {
    store.upsertSession('b', { defaultTitle: 'B', at: 1_000 });
    store.upsertSession('a', { defaultTitle: 'A', at: 1_000 });
    const page = store.listSessions({ limit: 10 });
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('cursor pagination pages correctly at page boundaries (limit=2 over 5 rows)', () => {
    for (let i = 0; i < 5; i++) {
      store.upsertSession(`s${i}`, {
        defaultTitle: `Session ${i}`,
        at: 1_000 + i,
      });
    }
    const page1 = store.listSessions({ limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(['s4', 's3']);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).toBeDefined();

    const page2 = store.listSessions({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.id)).toEqual(['s2', 's1']);
    expect(page2.total).toBe(5);
    expect(page2.nextCursor).toBeDefined();

    const page3 = store.listSessions({ limit: 2, cursor: page2.nextCursor });
    expect(page3.items.map((i) => i.id)).toEqual(['s0']);
    expect(page3.nextCursor).toBeUndefined();
  });

  test('a malformed cursor is treated as no cursor (returns page 1) rather than throwing', () => {
    store.upsertSession('s1', { defaultTitle: 'One', at: 1_000 });
    expect(() =>
      store.listSessions({ limit: 10, cursor: 'not-a-valid-cursor!!' }),
    ).not.toThrow();
  });

  test('search filters by title, case-insensitive substring match', () => {
    store.upsertSession('s1', { defaultTitle: 'Talking about cats', at: 1_000 });
    store.upsertSession('s2', { defaultTitle: 'Talking about dogs', at: 2_000 });
    const page = store.listSessions({ search: 'CATS', limit: 10 });
    expect(page.items.map((i) => i.id)).toEqual(['s1']);
    expect(page.total).toBe(1);
  });

  test('search with no matches returns an empty page, not an error', () => {
    store.upsertSession('s1', { defaultTitle: 'Talking about cats', at: 1_000 });
    const page = store.listSessions({ search: 'zzz-no-match', limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  test('listSessions items carry the exact SessionListItemDTO shape (owner/timestamps present, lastMessageAt/runId optional)', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    const page = store.listSessions({ limit: 10 });
    expect(page.items[0]).toEqual({
      id: 's1',
      title: 'New chat',
      owner: 'local',
      createdAt: 1_000,
      updatedAt: 1_000,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `store.listSessions` is not a function yet.

- [ ] **Step 3: Add cursor helpers + `listSessions` to `src/session/store.ts`**

Add the contracts import at the top of the file (alongside the existing `bun:sqlite`/`node:fs`/`node:path` imports):
```typescript
import type { SessionListItemDTO } from '../contracts/index.ts';
```

Add the cursor encode/decode helpers near the top of the file, after `toStoredMessage`:
```typescript
function encodeSessionCursor(sortKey: number, id: string): string {
  return Buffer.from(`${sortKey}:${id}`).toString('base64url');
}

function decodeSessionCursor(
  cursor: string,
): { sortKey: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const sortKey = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(sortKey) || id.length === 0) return undefined;
    return { sortKey, id };
  } catch {
    return undefined;
  }
}
```

Add `listSessions` after `getMessages` (before the `return { ... }` block):
```typescript
  function listSessions(q: {
    search?: string;
    cursor?: string;
    limit: number;
  }): { items: SessionListItemDTO[]; nextCursor?: string; total: number } {
    const searchClause = q.search ? 'AND lower(title) LIKE ?' : '';
    const searchArgs: (string | number)[] = q.search
      ? [`%${q.search.toLowerCase()}%`]
      : [];

    const totalRow = db
      .query(`SELECT COUNT(*) as n FROM sessions WHERE 1 = 1 ${searchClause}`)
      .get(...searchArgs) as { n: number };

    // A malformed cursor is treated as absent (page 1), never thrown — the
    // list endpoint must degrade gracefully on a tampered/garbage cursor
    // value, matching runs/list.ts's decodeCursorId precedent.
    const cursor = q.cursor ? decodeSessionCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? `AND (COALESCE(last_message_at, created_at) < ?
          OR (COALESCE(last_message_at, created_at) = ? AND id > ?))`
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.sortKey, cursor.sortKey, cursor.id]
      : [];

    // Fetch one extra row to detect "more remain" without a second query.
    const rows = db
      .query(
        `SELECT * FROM sessions WHERE 1 = 1 ${searchClause} ${cursorClause}
         ORDER BY COALESCE(last_message_at, created_at) DESC, id ASC
         LIMIT ?`,
      )
      .all(...searchArgs, ...cursorArgs, q.limit + 1) as SessionRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items: SessionListItemDTO[] = page.map((r) => {
      const row = toSessionRow(r);
      return {
        id: row.id,
        title: row.title,
        owner: row.owner,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastMessageAt: row.lastMessageAt,
        runId: row.runId,
      };
    });

    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeSessionCursor(
            lastRaw.last_message_at ?? lastRaw.created_at,
            lastRaw.id,
          )
        : undefined;

    return { items, nextCursor, total: totalRow.n };
  }
```
Update the returned object to its final Increment-1 shape:
```typescript
  return {
    upsertSession,
    getSession,
    renameSession,
    deleteSession,
    listSessions,
    appendMessage,
    getMessages,
    close: (): void => db.close(),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: PASS (all 25 tests — 17 from Tasks 5-7 + 8 new in this task).

- [ ] **Step 5: Run the full session module suite (regression check)**

Run: `bun test tests/session/`
Expected: PASS — `tests/session/migrations.test.ts` (5) + `tests/session/store.test.ts` (25) = 30 tests, all green.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/store.ts tests/session/store.test.ts
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): add listSessions SQL keyset cursor pagination (Phase 6 Incr 1)"
```

---

