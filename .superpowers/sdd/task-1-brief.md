## Task 1: Session DTOs — `SessionListItemDtoSchema` + `SessionDtoSchema`

**Files:**
- Modify: `src/contracts/dto.ts` (append after the existing `ChatMessageDtoSchema` block, currently lines 124-131)
- Test: `tests/contracts/session-dto.test.ts` (create)

**Interfaces:**
- Consumes: `ChatMessageDtoSchema`/`ChatMessageDTO` (`src/contracts/dto.ts:124-131`, unchanged); `ChatRole` (`src/contracts/enums.ts:59-63`, unchanged) — test-only import.
- Produces: `SessionListItemDtoSchema` / `SessionListItemDTO` = `{ id: string; title: string; owner: string; createdAt: number; updatedAt: number; lastMessageAt?: number; runId?: string }`. `SessionDtoSchema` / `SessionDTO` = the same fields plus `{ messages: ChatMessageDTO[] }`. Both re-exported via `src/contracts/index.ts`'s existing `export * from './dto.ts'` wildcard — no barrel edit needed (this task's test imports from `index.ts` to prove it).

- [ ] **Step 1: Write the failing test**

`tests/contracts/session-dto.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  SessionDtoSchema,
  SessionListItemDtoSchema,
} from '../../src/contracts/index.ts';

test('SessionListItemDtoSchema round-trips a minimal session summary (no optional fields)', () => {
  const parsed = SessionListItemDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  expect(parsed).toEqual({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  expect(parsed.lastMessageAt).toBeUndefined();
  expect(parsed.runId).toBeUndefined();
});

test('SessionListItemDtoSchema accepts lastMessageAt/runId when present', () => {
  const parsed = SessionListItemDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 2_000,
    lastMessageAt: 2_000,
    runId: 'run-abc',
  });
  expect(parsed.lastMessageAt).toBe(2_000);
  expect(parsed.runId).toBe('run-abc');
});

test('SessionListItemDtoSchema rejects a payload missing a required field', () => {
  expect(() =>
    SessionListItemDtoSchema.parse({ title: 'New chat' }),
  ).toThrow();
});

test('SessionDtoSchema embeds ChatMessageDTO[] verbatim (spec D8)', () => {
  const parsed = SessionDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
    messages: [
      { id: 'm1', role: ChatRole.User, text: 'hello' },
      { id: 'm2', role: ChatRole.Assistant, text: 'hi there', degraded: true },
    ],
  });
  expect(parsed.messages).toHaveLength(2);
  expect(parsed.messages[0]?.role).toBe(ChatRole.User);
  expect(parsed.messages[1]?.degraded).toBe(true);
});

test('SessionDtoSchema accepts an empty transcript (a brand-new session)', () => {
  const parsed = SessionDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
    messages: [],
  });
  expect(parsed.messages).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/contracts/session-dto.test.ts`
Expected: FAIL — `SessionListItemDtoSchema`/`SessionDtoSchema` are not exported from `src/contracts/index.ts` (module has no such export).

- [ ] **Step 3: Append the schemas to `src/contracts/dto.ts`**

Read the file first (already read; `ChatMessageDtoSchema` is at lines 124-131, `CrewMemberDtoSchema` starts at 137). Insert the following block immediately after `export type ChatMessageDTO = z.infer<typeof ChatMessageDtoSchema>;` (line 131) and before the `CrewMemberDtoSchema` comment (line 133):
```typescript
/** A session's list-row projection — enough for `/sessions`'s list/search
 *  view. `owner` is reserved (constant `'local'` today; Slices 24/33 backfill
 *  real ownership — same precedent as `RunDtoSchema.owner`). `lastMessageAt`
 *  is absent for a brand-new session with no messages yet (the store falls
 *  back to `createdAt` for sorting — spec D10). Slice 30b Phase 6 (spec §4.1). */
export const SessionListItemDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastMessageAt: z.number().optional(),
  runId: z.string().optional(),
});
export type SessionListItemDTO = z.infer<typeof SessionListItemDtoSchema>;

/** A session's full detail projection — the list-item fields plus its
 *  complete transcript, reusing `ChatMessageDtoSchema` verbatim (spec D8) —
 *  no new message DTO. Slice 30b Phase 6 (spec §4.1). */
export const SessionDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastMessageAt: z.number().optional(),
  runId: z.string().optional(),
  messages: z.array(ChatMessageDtoSchema),
});
export type SessionDTO = z.infer<typeof SessionDtoSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/contracts/session-dto.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/dto.ts tests/contracts/session-dto.test.ts
git add src/contracts/dto.ts tests/contracts/session-dto.test.ts
git commit -m "feat(contracts): add SessionListItemDtoSchema/SessionDtoSchema (Phase 6 Incr 1)"
```

---

