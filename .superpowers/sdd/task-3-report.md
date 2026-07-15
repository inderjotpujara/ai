# Task 3 report — RunListQuery + RunListResponse request/response schemas

## Status: DONE — GREEN, committed

## TDD Cycle

**RED** — Added three failing tests to `tests/contracts/requests.test.ts`:
1. `RunListQuery coerces string query params and defaults limit` — verifies coercion of string `limit` to number, `degraded` from string `'true'/'false'` to boolean, and optional fields pass through
2. `RunListQuery applies the default limit when omitted` — confirms the `limit` field defaults to 25 when omitted, and optional fields remain undefined
3. `RunListResponse validates items + pagination` — verifies response validation with array of `RunListItemDTO`, optional `nextCursor`, and required `total`

Ran focused test:
```
bun test --path-ignore-patterns 'web/**' tests/contracts/requests.test.ts
```
Failed as expected: `RunListQuerySchema` and `RunListResponseSchema` not yet exported (import error).

**Implementation** — Exactly per brief (`/.superpowers/sdd/task-3-brief.md`):
- `src/contracts/requests.ts`: 
  - Added import: `import { RunListItemDtoSchema } from './dto.ts';` (after zod import, before enums import per biome sort order)
  - Appended `RunListQuerySchema` with fields: `search?` (string), `outcome?` (string), `degraded?` (enum ['true', 'false'] with transform to boolean), `limit` (z.coerce.number with `.int().positive().max(200).default(25)`), `cursor?` (string)
  - Appended `RunListResponseSchema` with fields: `items` (array of `RunListItemDtoSchema`), `nextCursor?` (string), `total` (number)
  - Added type aliases using `z.infer<typeof ...Schema>` per existing pattern
- `tests/contracts/requests.test.ts`: 
  - Updated imports to include `RunListQuerySchema`, `RunListResponseSchema`, `RunLifecycle`, `RunOrigin`
  - Appended all three test cases verbatim from brief
- `src/contracts/index.ts`: No changes needed — barrel already exports `* from './requests.ts'`.

**GREEN**:
```
bun test --path-ignore-patterns 'web/**' tests/contracts/requests.test.ts
 14 pass / 0 fail / 19 expect() calls
```
All 14 tests pass (11 pre-existing + 3 new for RunListQuery/RunListResponse).

```
bun test --path-ignore-patterns 'web/**' tests/contracts/
 36 pass / 0 fail / 65 expect() calls
```
All 36 contract tests pass (no regressions).

## Gate

- `bun run typecheck` → clean (no output from `tsc --noEmit`).
- `bun run lint:file -- "src/contracts/requests.ts" "tests/contracts/requests.test.ts"` → `Checked 2 files in 2ms. No fixes applied.` (after applying biome auto-fixes for import sort order and formatting).
- Pre-commit hook ran automatically on `git commit` → `✔ docs-check: living docs present + linked; every src subsystem documented.`

## Commit

```
70ced40 feat(contracts): RunListQuery + RunListResponse schemas for Runs list endpoint
```

Commit message body:
```
Add RunListQuerySchema with query param coercion (limit defaults to 25,
degraded coerces string 'true'/'false' to boolean) and RunListResponseSchema
for paginated run summaries with nextCursor and total. Imports RunListItemDtoSchema
from dto.ts (Task 2) per the isomorphism guard.
```

## Files Changed
- `src/contracts/requests.ts` — added import + `RunListQuerySchema` + `RunListQuery` type + `RunListResponseSchema` + `RunListResponse` type (23 new lines).
- `tests/contracts/requests.test.ts` — expanded imports, appended 3 new test cases (52 new lines, 1 modified line for import expansion).

## Self-Review

- **Schema completeness**: 
  - `RunListQuerySchema`: All 5 fields match brief exactly. `search?`, `outcome?`, `cursor?` are plain optional strings. `degraded?` uses `.enum(['true', 'false']).optional().transform(...)` to coerce web query strings to boolean. `limit` uses `z.coerce.number().int().positive().max(200).default(25)` — coerces string input from query params, validates positive integer, enforces max 200, applies default 25.
  - `RunListResponseSchema`: `items` references `RunListItemDtoSchema` (imported from dto.ts per isomorphism guard). `nextCursor?` optional string. `total` required number.

- **Query param coercion**: Verified by test: `degraded: 'true'` (string from HTTP query) parses to `degraded: true` (boolean); `limit: '10'` (string) parses to `limit: 10` (number). Default limit applied when `{ }` parsed.

- **Pagination shape**: Response includes `items` (array of DTO), `nextCursor?` (for continuation), `total` (cardinality hint). Matches typical paginated API envelope.

- **Import ordering**: Biome auto-organized imports: zod first, then sibling imports (dto, enums) in alphabetical order.

- **Export barrel**: No changes needed; auto-exported via existing `export * from './requests.ts'` in `src/contracts/index.ts`. Confirmed by isomorphic test suite pass (contract tests include `isomorphic.test.ts` which verifies the sibling import is allowed by the isomorphism guard).

- **Type inference**: Both schemas use `z.infer<typeof XSchema>` pattern, matching existing `ChatRequest`, `FeedbackRequest`, etc. in the same file.

- **Tests exercise real behavior**:
  1. Test 1: Coercion + optional fields present
  2. Test 2: Default + optional fields absent (undefined, not omitted from object)
  3. Test 3: Response validation with a minimal RunListItemDTO, pagination fields

- **Code style consistency**: Schema formatting, optional placement, and enum reference pattern match existing request schemas in the same file.

## Concerns

None. Implementation matches brief exactly: schemas, types, tests, and exports all correct. Isomorphic guard satisfied (sibling import from dto.ts permitted). All 36 contract tests pass with no regressions. Typecheck and lint clean.

---

## Review Fix — untested coercion rejection/boundary paths

**Finding (Important):** The task review found the `RunListQuerySchema` coercion's rejection/boundary paths were untested — only the happy-path coercion (`limit: '10'` → `10`, `degraded: 'true'` → `true`) and the default-limit case were covered. The `.int().positive().max(200)` guards on `limit` and the `.enum(['true', 'false'])` guard on `degraded` had no tests proving they actually reject bad input. This was a **test-only** fix — `src/contracts/requests.ts` logic was already correct and unchanged.

**Verified guards (read from `src/contracts/requests.ts` lines 53–70 before writing tests, to match reality rather than assume):**
```ts
export const RunListQuerySchema = z.object({
  search: z.string().optional(),
  outcome: z.string().optional(),
  degraded: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().positive().max(200).default(25),
  cursor: z.string().optional(),
});

export const RunListResponseSchema = z.object({
  items: z.array(RunListItemDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
});
```
Confirmed `max` is indeed `200` (not assumed) and `positive()` means `0` is rejected, not just negatives.

**Tests added** to `tests/contracts/requests.test.ts` (following the existing `FeedbackRequest rejects an invalid rating enum value` / `FeedbackRequest rejects a missing messageId` prior art — `expect(() => Schema.parse(bad)).toThrow()` / `.safeParse(...).success === false`), inserted between the existing `RunListQuery applies the default limit when omitted` test and the `RunListResponse validates items + pagination` test:

1. `RunListQuery coerces a numeric-string limit to a number` — `RunListQuerySchema.parse({ limit: '10' })` → `parsed.limit === 10` (positive control, proves coercion still works).
2. `RunListQuery rejects a non-numeric limit` — `{ limit: 'abc' }` throws.
3. `RunListQuery rejects a zero limit (must be positive)` — `{ limit: '0' }` throws (boundary: `positive()` excludes 0).
4. `RunListQuery rejects a negative limit` — `{ limit: '-5' }` throws.
5. `RunListQuery rejects a limit above the max of 200` — `{ limit: '201' }` throws (boundary: confirms `max(200)`, i.e. `200` itself would pass, `201` fails).
6. `RunListQuery rejects a non-integer limit` — `{ limit: '10.5' }` throws (`int()` guard).
7. `RunListQuery rejects a degraded value that is neither true nor false` — `{ degraded: 'yes' }` and `{ degraded: '1' }` both throw (enum guard, not a loose boolean coercion).
8. `RunListResponse rejects a payload missing the required total` — `{ items: [] }` via `.safeParse(...).success === false`.
9. `RunListResponse rejects a payload missing the required items` — `{ total: 0 }` via `.safeParse(...).success === false`.

### Commands run + output

```
$ bun test tests/contracts/requests.test.ts
bun test v1.3.11 (af24e281)
 23 pass
 0 fail
 29 expect() calls
Ran 23 tests across 1 file. [31.00ms]
```
(14 pre-existing + 9 new = 23; all green, no regressions.)

```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)
```

```
$ bun run lint:file -- "tests/contracts/requests.test.ts"
$ biome check tests/contracts/requests.test.ts
Checked 1 file in 3ms. No fixes applied.
```

Pre-commit hook ran automatically on `git commit` → `✔ docs-check: living docs present + linked; every src subsystem documented.`

### Commit

```
0956bc4 test(contracts): boundary/rejection tests for RunListQuery coercion + RunListResponse required fields
```
1 file changed (`tests/contracts/requests.test.ts`), 40 insertions, 0 deletions. No changes to `src/contracts/requests.ts` — schema logic untouched, as required.

### Files changed
- `tests/contracts/requests.test.ts` — 9 new tests added (boundary/rejection coverage for `RunListQuerySchema.limit`, `RunListQuerySchema.degraded`, and `RunListResponseSchema` required fields).

### Concerns

None. This closes the Important finding without touching production schema logic. All boundary values were read from the actual schema source (not assumed) before writing assertions.
