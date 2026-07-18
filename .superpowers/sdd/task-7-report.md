# Task 7 Report: `appendMessage` / `getMessages` (+ deferred cascade-delete test)

## Status: DONE

## Commit
`04b578d` — `feat(session): add appendMessage/getMessages with idempotent insert (Phase 6 Incr 1)`

## What was implemented

`src/session/store.ts`:
- Added `StoredMessage` type (raw, un-decoded `parts`) + `MessageRowRaw` + `toStoredMessage` helper, placed right after the existing `SessionRowRaw`/`toSessionRow` block.
- Added `appendMessage(sessionId, msg, at)`:
  - `INSERT OR IGNORE` on `messages` keyed by `msg.id` — a duplicate/retried post is a safe no-op, first write wins.
  - `parentMessageId` defaults to `NULL` when absent; `degraded` uses tri-state mapping (`undefined→NULL`, `false→0`, `true→1`).
  - Then unconditionally runs `UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?` with `at` — this fires even on the IGNORE'd duplicate-insert path (matches brief exactly; not gated on insert having actually happened).
- Added `getMessages(sessionId)`: `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`, mapped through `toStoredMessage` (degraded round-trips `NULL→undefined`, `0→false`, `1→true`).
- Both added to the returned object after `deleteSession`.

`tests/session/store.test.ts`:
- Replaced the Task-6 deferred `NOTE` comment inside `describe('renameSession / deleteSession', ...)` with the real `deleteSession cascades — messages are gone too` test.
- Appended `describe('appendMessage / getMessages', ...)` with 7 tests (store+read, idempotent dedup, parentMessageId/degraded=true, degraded=false round-trip, created_at ASC ordering, empty array on no messages, session-scoping/no-leak).

## RED evidence (before implementation)
`bun test tests/session/store.test.ts` → **9 pass / 8 fail** — all failures `TypeError: store.appendMessage is not a function` / `store.getMessages is not a function` (the new cascade test + all 7 new-describe tests); the 9 pre-existing Task 5/6 tests still passed.

## GREEN evidence (after implementation)
`bun test tests/session/store.test.ts` → **17 pass / 0 fail**, 42 `expect()` calls (5 Task-5 + 5 Task-6 + 7 Task-7 = 17, matches brief).

## Gate (all three, in order)
1. `bun run typecheck` → clean (`tsc --noEmit`, no errors).
2. `bun run lint:file -- src/session/store.ts tests/session/store.test.ts` → initially flagged 1 formatting diff in the test file (long-line wrapping of an object literal, plus a quote-style choice for a string containing an apostrophe); ran biome's `--write` autofix, which reformatted `tests/session/store.test.ts` only (no logic change, purely cosmetic re-wrap); re-ran lint clean (0 errors).
3. `bun test tests/session/store.test.ts` → 17/17 pass (shown above).

## Files changed
- `/Users/inderjotsingh/ai/src/session/store.ts`
- `/Users/inderjotsingh/ai/tests/session/store.test.ts`

`git status --short` confirmed only these two files were staged/committed (a large batch of already-modified `.superpowers/sdd/*.md` / `.remember/*.md` files from other tasks in this session were deliberately left unstaged).

## Self-review
- Signature, SQL, and mapping logic match the brief verbatim; no scope creep (YAGNI held — only `StoredMessage` + the two methods this task, no extra helpers).
- `appendMessage`'s timestamp UPDATE runs unconditionally (even on an ignored duplicate insert) exactly as specified in the brief's Step 3 code — this is intentional design (a retried POST still "touches" activity), not accidental over-eagerness.
- Tri-state `degraded` mapping verified by both the `true` and explicit-`false` tests; `undefined` (omitted) path covered by the first append test.
- Cascade test now exercises `appendMessage`+`getMessages` for real (previously only asserted the session-row half); confirms `deleteSession`'s transactional `DELETE FROM messages` still empties `getMessages` post-delete.
- No `console.log`; strict TS `noUncheckedIndexedAccess` respected — test assertions use `messages[0]?.` chaining throughout.

## Concerns / flags for the controller

**`run_id` design flag (restated per brief, for Increment 2):** Spec §4.3 says `appendMessage` "touches `sessions.updated_at`/`last_message_at`/`run_id`", but the locked Increment-1 signature (`msg: { id, role, parts, parentMessageId?, degraded? }`) carries **no `runId` field**. This task's `appendMessage` therefore updates `updated_at`/`last_message_at` only and leaves `sessions.run_id` untouched — it stays whatever `upsertSession` left it (always `NULL` in Increment 1, since `upsertSession` never sets it either). **Increment 2 (chat wiring), specifically T21, must decide how `sessions.run_id` actually gets populated** — e.g. extend `appendMessage`'s `msg` type with an optional `runId`, or add a small dedicated `setRunId(id, runId)` method — since nothing in this increment's locked signature carries that data. No other blocking concerns; implementation is straightforward CRUD matching the brief exactly.
