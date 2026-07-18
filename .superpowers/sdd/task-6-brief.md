## Task 6: `renameSession` / `deleteSession` (cascade delete)

**Files:**
- Modify: `src/session/store.ts` (add two methods to the returned closure)
- Modify: `tests/session/store.test.ts` (append a `describe` block; needs `appendMessage`/`getMessages` from Task 7 for the cascade assertion — see the note in Step 1 below)

**Interfaces:**
- Consumes: nothing new.
- Produces: `renameSession(id: string, title: string, at: number): void` (plain `UPDATE`, no existence check — a rename of an absent id is a silent no-op, consistent with `upsertSession`'s style of never throwing on a missing/duplicate row). `deleteSession(id: string): void` — a single transaction that deletes `messages` for that session THEN the `sessions` row (spec §4.3), so a crash mid-delete never leaves orphaned messages with no parent.

**Sequencing note:** this task's cascade-delete test needs to insert a message to prove it's gone after delete, which needs `appendMessage`/`getMessages` — implemented in Task 7. **Do Task 7 first if executing tasks out of order is preferred; as written, this task's Step 1 test stub is added now but the cascade sub-test is marked `test.skip` until Task 7 lands it for real in Step 3 of Task 7.** (This keeps each task's own diff runnable/green in isolation, per the TDD gate rule, without forward-referencing an unbuilt method.)

- [ ] **Step 1: Write the failing tests**

Modify `tests/session/store.test.ts` to its full new content — insert this new `describe` block immediately after the existing `describe('upsertSession / getSession', ...)` block (before the closing of the file):
```typescript
describe('renameSession / deleteSession', () => {
  test('renameSession updates title and updatedAt', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.renameSession('s1', 'My renamed chat', 2_000);
    const row = store.getSession('s1');
    expect(row?.title).toBe('My renamed chat');
    expect(row?.updatedAt).toBe(2_000);
  });

  test('renameSession on an absent id is a silent no-op (never throws)', () => {
    expect(() => store.renameSession('nope', 'New title', 1)).not.toThrow();
    expect(store.getSession('nope')).toBeUndefined();
  });

  test('deleteSession removes the session row', () => {
    store.upsertSession('s1', { defaultTitle: 'New chat', at: 1_000 });
    store.deleteSession('s1');
    expect(store.getSession('s1')).toBeUndefined();
  });

  test('deleteSession on an absent id is a silent no-op (never throws)', () => {
    expect(() => store.deleteSession('nope')).not.toThrow();
  });

  // NOTE: the full cascade assertion (messages also gone) is added for real
  // in Task 7 Step 3, once appendMessage/getMessages exist — this task only
  // proves the session-row half of the delete.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `store.renameSession`/`store.deleteSession` are not functions yet (the pre-existing `upsertSession`/`getSession` tests still PASS).

- [ ] **Step 3: Add `renameSession`/`deleteSession` to `src/session/store.ts`**

Insert these two functions immediately after `getSession` (before the `return { ... }` block), and add both to the returned object:
```typescript
  function renameSession(id: string, title: string, at: number): void {
    db.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [
      title,
      at,
      id,
    ]);
  }

  function deleteSession(id: string): void {
    // Transaction: delete messages THEN the session row (spec §4.3) — a
    // crash mid-delete never leaves orphaned messages with no parent.
    const tx = db.transaction(() => {
      db.run('DELETE FROM messages WHERE session_id = ?', [id]);
      db.run('DELETE FROM sessions WHERE id = ?', [id]);
    });
    tx();
  }
```
Update the returned object to:
```typescript
  return {
    upsertSession,
    getSession,
    renameSession,
    deleteSession,
    close: (): void => db.close(),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/session/store.ts tests/session/store.test.ts
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): add renameSession/deleteSession with transactional cascade (Phase 6 Incr 1)"
```

---

