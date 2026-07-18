# Task 8 Report: `listSessions` — SQL keyset cursor pagination (Slice 30b Phase 6, Increment 1)

(Note: this file name was previously used by an earlier Slice-30b-Phase-5
Task 8 — the web Builders route scaffold. That work is preserved in git
history/on the Phase-5 branch/merge commits. This report replaces it for
the current Phase-6 Task 8: `listSessions` on `src/session/store.ts`, the
last method of the Increment-1 `SessionStore`.)

## Status: DONE

## Implemented

- `src/session/store.ts`:
  - Added `import type { SessionListItemDTO } from '../contracts/index.ts'`.
  - Added `encodeSessionCursor(sortKey, id)` / `decodeSessionCursor(cursor)` helpers
    right after `toStoredMessage` (before `SessionStoreDeps`). Cursor is
    `base64url(sortKey:id)`; decode wraps in `try/catch`, validates the `:`
    separator, `Number.isFinite(sortKey)`, and non-empty `id` — any failure
    returns `undefined` (never throws), matching `src/server/runs/list.ts`'s
    `decodeCursorId` precedent.
  - Added `listSessions(q: { search?; cursor?; limit })` inside
    `createSessionStore`, after `getMessages`:
    - `total` = `SELECT COUNT(*) ... WHERE 1=1 [AND lower(title) LIKE ?]`
      (post-search-filter count, not page size).
    - Keyset WHERE clause (only when a valid cursor decodes):
      `AND (COALESCE(last_message_at, created_at) < ? OR (COALESCE(last_message_at, created_at) = ? AND id > ?))`.
    - Page query: `SELECT * FROM sessions WHERE 1=1 [search] [cursor] ORDER BY COALESCE(last_message_at, created_at) DESC, id ASC LIMIT ?` with `limit + 1` to detect `hasMore` without a second round trip.
    - Maps `SessionRowRaw` → `SessionListItemDTO` (via existing `toSessionRow`), slices to `q.limit`, and only emits `nextCursor` when `hasMore` and a last row exists.
  - Wired `listSessions` into the final returned object (now: `upsertSession, getSession, renameSession, deleteSession, listSessions, appendMessage, getMessages, close`) — this is the final Increment-1 shape.
- `tests/session/store.test.ts`: appended `describe('listSessions', ...)` with the 8 tests verbatim from the brief (empty page, COALESCE sort order, id tie-break, page-boundary cursor pagination over 5 rows at limit=2, malformed-cursor-never-throws, case-insensitive search match, search-no-match empty page, exact DTO shape). Two of those tests were reformatted by `biome format --write` (wrapped the `upsertSession` object args onto multiple lines to fit line width) — pure formatting, no logic change.

## RED evidence

Before implementation: `bun test tests/session/store.test.ts` → 17 pass / 8 fail, all 8 failures `TypeError: store.listSessions is not a function`.

## GREEN evidence

- `bun test tests/session/store.test.ts` → **25 pass, 0 fail** (63 expect() calls).
- `bun test tests/session/` (regression) → **30 pass, 0 fail** (73 expect() calls) — 5 migrations + 25 store.

## Gate

- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- src/session/store.ts tests/session/store.test.ts` → initially flagged a formatting issue in the two new search tests (line-wrap of `upsertSession` call args); fixed via `bunx biome format --write tests/session/store.test.ts` (pure reformat, no semantic change), then clean on re-run.

## Files changed

- `/Users/inderjotsingh/ai/src/session/store.ts`
- `/Users/inderjotsingh/ai/tests/session/store.test.ts`

## Commit

`34298d0` — `feat(session): add listSessions SQL keyset cursor pagination (Phase 6 Incr 1)`
(2 files changed, 177 insertions(+); pre-commit `docs:check` hook passed — no `src/` subsystem shape changed, only a method added to an already-documented store).

## Self-review

- SQL keyset clause implemented byte-for-byte from the brief — did not "improve" it (e.g. did not collapse to a single comparison or use a computed column).
- `noUncheckedIndexedAccess` respected: `page[page.length - 1]` is typed `SessionRowRaw | undefined` and guarded via `hasMore && lastRaw` before use.
- Malformed-cursor test only asserts `not.toThrow()`, consistent with brief; decode helper correctly returns `undefined` for `'not-a-valid-cursor!!'` (base64url-decodes to garbage with no `:` separator or non-finite sortKey), so the query silently runs as page-1.
- No `console.log` introduced; no `interface` used (all `type`); no new enums needed (YAGNI — task brief specifies only these two helpers + `listSessions`).

## Concerns

None blocking. Two minor observations for later phases, not this task's scope:
1. `search` and `cursor` clauses are string-interpolated into the SQL (not parameterized in the query text itself — only their bound `?` args are parameterized). This is safe because the interpolated strings are fixed literals chosen from a closed set (`''` or the exact clause text), never user input, so there's no injection surface. Flagging only so a future refactor doesn't assume otherwise.
2. This task only wires `listSessions` into the SessionStore; the HTTP-facing `GET /api/sessions` endpoint (server route) is presumably a later Increment/task in this phase — not built here per brief scope (YAGNI holds to `listSessions` + cursor helpers only).

Report file: `/Users/inderjotsingh/ai/.superpowers/sdd/task-8-report.md`
