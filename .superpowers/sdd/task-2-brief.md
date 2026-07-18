## Task 2: Session request/response contracts — `SessionListQuerySchema` / `SessionListResponseSchema` / `SessionRenameRequestSchema`

**Files:**
- Modify: `src/contracts/requests.ts` (add `SessionListItemDtoSchema` to the existing `./dto.ts` import; append three schemas at the end of the file)
- Test: `tests/contracts/session-requests.test.ts` (create)

**Interfaces:**
- Consumes: `SessionListItemDtoSchema` (Task 1, `src/contracts/dto.ts`).
- Produces: `SessionListQuerySchema` / `SessionListQuery` = `{ search?: string; limit: number (default 25, coerced, 1-200); cursor?: string }`. `SessionListResponseSchema` / `SessionListResponse` = `{ items: SessionListItemDTO[]; nextCursor?: string; total: number }`. `SessionRenameRequestSchema` / `SessionRenameRequest` = `{ title: string (1-200 chars) }`. All re-exported via `src/contracts/index.ts`'s existing wildcard — no barrel edit needed.

- [ ] **Step 1: Write the failing test**

`tests/contracts/session-requests.test.ts`:
```typescript
import { expect, test } from 'bun:test';
import {
  SessionListQuerySchema,
  SessionListResponseSchema,
  SessionRenameRequestSchema,
} from '../../src/contracts/index.ts';

test('SessionListQuerySchema defaults limit to 25 when absent', () => {
  const parsed = SessionListQuerySchema.parse({});
  expect(parsed.limit).toBe(25);
  expect(parsed.search).toBeUndefined();
  expect(parsed.cursor).toBeUndefined();
});

test('SessionListQuerySchema coerces a string limit from a query param', () => {
  const parsed = SessionListQuerySchema.parse({ limit: '10' });
  expect(parsed.limit).toBe(10);
});

test('SessionListQuerySchema rejects a limit above 200', () => {
  expect(() => SessionListQuerySchema.parse({ limit: '500' })).toThrow();
});

test('SessionListQuerySchema rejects a non-positive limit', () => {
  expect(() => SessionListQuerySchema.parse({ limit: '0' })).toThrow();
});

test('SessionListQuerySchema accepts search + cursor', () => {
  const parsed = SessionListQuerySchema.parse({
    search: 'cats',
    cursor: 'b3B0aG9wYXF1ZQ',
  });
  expect(parsed.search).toBe('cats');
  expect(parsed.cursor).toBe('b3B0aG9wYXF1ZQ');
});

test('SessionListResponseSchema round-trips a page with no nextCursor (last page)', () => {
  const parsed = SessionListResponseSchema.parse({
    items: [
      {
        id: 'sess-1',
        title: 'New chat',
        owner: 'local',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    total: 1,
  });
  expect(parsed.items).toHaveLength(1);
  expect(parsed.nextCursor).toBeUndefined();
});

test('SessionListResponseSchema round-trips a page with a nextCursor', () => {
  const parsed = SessionListResponseSchema.parse({
    items: [],
    total: 5,
    nextCursor: 'b3B0aG9wYXF1ZQ',
  });
  expect(parsed.nextCursor).toBe('b3B0aG9wYXF1ZQ');
});

test('SessionRenameRequestSchema accepts a normal title', () => {
  expect(SessionRenameRequestSchema.parse({ title: 'My renamed chat' }).title).toBe(
    'My renamed chat',
  );
});

test('SessionRenameRequestSchema rejects an empty title', () => {
  expect(() => SessionRenameRequestSchema.parse({ title: '' })).toThrow();
});

test('SessionRenameRequestSchema rejects a title over 200 chars', () => {
  expect(() =>
    SessionRenameRequestSchema.parse({ title: 'x'.repeat(201) }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/contracts/session-requests.test.ts`
Expected: FAIL — none of the three schemas are exported yet.

- [ ] **Step 3: Add the `SessionListItemDtoSchema` import and append the three schemas to `src/contracts/requests.ts`**

Modify the existing `./dto.ts` import block (currently lines 2-8) to its full new content:
```typescript
import {
  CrewListItemDtoSchema,
  McpServerDtoSchema,
  ModelInventoryDtoSchema,
  RunListItemDtoSchema,
  SessionListItemDtoSchema,
  WorkflowListItemDtoSchema,
} from './dto.ts';
```

Append at the end of the file (after the existing `BuilderRegistryListResponseSchema` block):
```typescript
/** `GET /api/sessions?search=&cursor=&limit=` query — mirrors
 *  `RunListQuerySchema`'s shape (Phase 3) minus the outcome/degraded/kind
 *  facets that don't apply to sessions. Slice 30b Phase 6 (spec D10/§4.1). */
export const SessionListQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  cursor: z.string().optional(),
});
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

/** `GET /api/sessions` response — byte-for-byte `RunListResponseSchema`'s
 *  shape (Phase 3): same opaque-cursor contract with the client, just backed
 *  by a real SQL keyset page instead of an in-process array (spec D10). */
export const SessionListResponseSchema = z.object({
  items: z.array(SessionListItemDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

/** `PATCH /api/sessions/:id` body — bounded the same way every other
 *  free-text body is (`BuilderBuildRequestSchema.need`, etc). Slice 30b
 *  Phase 6 (spec §4.1). */
export const SessionRenameRequestSchema = z.object({
  title: z.string().min(1).max(200),
});
export type SessionRenameRequest = z.infer<typeof SessionRenameRequestSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/contracts/session-requests.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Run the full contracts suite (regression check on the shared import edit)**

Run: `bun test tests/contracts/`
Expected: PASS — the `./dto.ts` import list edit only adds a name, it cannot break any existing schema in `requests.ts`.

- [ ] **Step 6: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/contracts/requests.ts tests/contracts/session-requests.test.ts
git add src/contracts/requests.ts tests/contracts/session-requests.test.ts
git commit -m "feat(contracts): add SessionListQuery/SessionListResponse/SessionRenameRequest schemas (Phase 6 Incr 1)"
```

---

