# Task 2 report: Session request/response contracts

## Status: DONE

## What was implemented

- `src/contracts/requests.ts`:
  - Added `SessionListItemDtoSchema` to the existing `./dto.ts` import block, in
    alphabetical order, preserving all 5 existing names
    (`CrewListItemDtoSchema`, `McpServerDtoSchema`, `ModelInventoryDtoSchema`,
    `RunListItemDtoSchema`, `WorkflowListItemDtoSchema`). Verified against the
    live file before editing — the brief's cited import list matched the
    actual file exactly (no drift from the "lines 2-8" snapshot note), so the
    prescribed full-block replacement was safe to apply as given.
  - Appended, after the existing `BuilderRegistryListResponseSchema` block:
    - `SessionListQuerySchema` / `SessionListQuery` — `search?`, `limit`
      (coerced int, 1-200, default 25), `cursor?`.
    - `SessionListResponseSchema` / `SessionListResponse` — `items:
      SessionListItemDTO[]`, `nextCursor?`, `total: number`.
    - `SessionRenameRequestSchema` / `SessionRenameRequest` — `title` (1-200
      chars).
  - No `.strict()`, zod-only + sibling `./dto.ts` import (isomorphic), each
    schema paired with an inferred `type`.
- `tests/contracts/session-requests.test.ts` (new): 10 tests (brief's Step 4
  text said "9 tests" but the brief's own verbatim test code contains 10
  `test()` blocks — implemented verbatim, all pass; flagging the count as a
  minor brief typo, not a deviation).
- Did **not** touch `src/contracts/index.ts` — the wildcard re-export covers
  the new exports (confirmed by the test file importing successfully from
  `../../src/contracts/index.ts`).

## TDD evidence

**RED** — `bun test tests/contracts/session-requests.test.ts` before Step 3:
```
SyntaxError: Export named 'SessionListResponseSchema' not found in module
'/Users/inderjotsingh/ai/src/contracts/index.ts'.
0 pass / 1 fail / 1 error
```

**GREEN** — after Step 3 edit, same command:
```
10 pass
0 fail
14 expect() calls
Ran 10 tests across 1 file. [26.00ms]
```

**Regression (brief Step 5)** — `bun test tests/contracts/`:
```
98 pass
0 fail
153 expect() calls
Ran 98 tests across 23 files. [60.00ms]
```
Confirms the shared `./dto.ts` import edit (adding one name) didn't disturb
any other schema in `requests.ts`.

## Gate

- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/contracts/requests.ts tests/contracts/session-requests.test.ts`
  → 1 formatting error on the first run (biome wanted the
  `SessionRenameRequestSchema accepts a normal title` test's `expect(...)`
  call reflowed differently than the brief's verbatim snippet). Applied
  biome's suggested reflow (semantically identical, same assertion) and
  re-ran: **0 errors**. Re-ran the focused test after the formatting edit —
  still 10/10 pass.

## Commit

`df304f9` — `feat(contracts): add SessionListQuery/SessionListResponse/SessionRenameRequest schemas (Phase 6 Incr 1)`
2 files changed, 106 insertions(+): `src/contracts/requests.ts`,
`tests/contracts/session-requests.test.ts`. Pre-commit `docs-check` passed
automatically ("✔ docs-check: living docs present + linked; every src
subsystem documented.") — no `architecture.md` update required (pure
addition inside the already-documented `src/contracts` subsystem).

## Self-review

- Import list verified against the live file first, per the task
  instructions' explicit anti-drift check — matched the brief exactly, so no
  alphabetical-splice fallback was needed.
- Schemas are structurally identical in shape/bounds to their `Run*`
  counterparts already in the file (`RunListQuerySchema`/
  `RunListResponseSchema`), consistent with the file's existing idiom and the
  brief's own comments citing that mirroring.
- No barrel edit; confirmed the wildcard re-export in `src/contracts/index.ts`
  already covers `requests.ts` (test imports resolved without touching it).
- YAGNI honored — only the 3 schema/type pairs the brief specifies, nothing
  extra.

## Concerns

- None blocking. Only note: the brief's Step 2/4 prose says "9 tests" while
  its own embedded test code has 10 — cosmetic mismatch in the brief text
  itself, doesn't affect correctness since the code was taken verbatim and all
  10 pass.
