# Task 17 Report: `go-agents` nav command + dedupe degenerate `jump-to-*`/`search-sessions` (D8)

## Summary

Followed TDD per the brief exactly.

1. **Step 1 (failing tests):** Replaced the `describe('navCommands', ...)` block in
   `web/src/app/commands.test.ts` with `describe('commands — deduped nav set + go-agents (D8, Task 17)', ...)`
   containing the three tests specified in the brief verbatim (go-agents label match, go-sessions
   replaces jump-to-sessions, and the four-id dedupe assertion).
2. **Step 2 (verify red):** Ran `bun run test -- app/commands.test.ts` — 3 failures as expected
   (`go-agents`/`go-sessions` undefined; old degenerate ids still present).
3. **Step 3 (implementation):** Edited `web/src/app/commands.ts`'s `commands` array:
   - Added `go-agents` (nav → `/builders`) with the code comment from the brief documenting the
     `/builders`-mapping rationale (no standalone `/agents` route/`AgentsArea` page exists;
     `features/agents/` is only Chat's embedded live-status rail) and the spec-owner sign-off flag.
   - Renamed `jump-to-sessions` → `go-sessions` (still → `/sessions`), with a comment noting this
     fills a real gap rather than deduping an actual duplicate.
   - Removed `jump-to-run`, `jump-to-crew`, `jump-to-workflow`, `search-sessions` entirely (pure
     duplicates of `go-runs`/`go-crews`/`go-workflows`/the old `jump-to-sessions`) — no replacement
     entries added.
   - Confirmed via `grep` that no other file in `web/src` referenced any of the four dropped ids or
     `jump-to-sessions`, so no other call sites needed updating.
4. **Step 4 (verify green):**
   - `bun run test -- app/commands.test.ts app/command-palette.test.tsx` — 13/13 passed.
   - `bun run typecheck` — clean.
   - Full `bun run test` — 61 test files / 339 tests passed (one unrelated stray `ECONNREFUSED`
     stderr log from an existing offline/network-failure test, not a failure — all tests reported
     passed).
5. **Format guard:** `bunx biome check --write web/src/app/commands.ts web/src/app/commands.test.ts`
   from `/Users/inderjotsingh/ai` — checked 2 files, fixed 1 (cosmetic line-wrap in the test file's
   long `toMatch` assertion). Re-ran the commands test after the fix — still 7/7 passed.
6. **Step 5 (commit):** Committed exactly the two files specified.

## Commit

`f5b5629` — `feat(cmdk): add go-agents (mapped to /builders — see surprise note), dedupe degenerate jump-to-*/search-sessions (D8)`
(2 files changed, 33 insertions(+), 46 deletions(-); pre-commit `docs-check` hook passed since no
`docs/architecture.md`-relevant subsystem changed).

## Test summary

- `commands.test.ts` + `command-palette.test.tsx`: 13/13 passed.
- `bun run typecheck`: clean.
- Full web suite: 61 files / 339 tests passed.

## Concerns / notes

- The `go-agents` → `/builders` mapping is a documented compromise per the brief's "surprise" note —
  no standalone Agents route exists today. This is flagged in-code for spec-owner sign-off before
  Increment 5's docs pass, per the brief; not resolved further in this task (out of scope).
- Task 18 (next) will add a new, differently-behaved `jump-to-recent-run` command — deliberately not
  touched here.
- Only `web/src/app/commands.ts` and `web/src/app/commands.test.ts` were staged/committed; other
  working-tree changes present at task start (SDD ledger/briefs/reports from prior tasks, `.remember/`
  buffers) were left untouched as out of scope for this task.

## Files touched

- `/Users/inderjotsingh/ai/web/src/app/commands.ts`
- `/Users/inderjotsingh/ai/web/src/app/commands.test.ts`
