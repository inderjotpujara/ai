# Task 3 Report: Config — `AGENT_SESSIONS_PATH` (Phase 6)

## Status: DONE

## What was implemented

- `src/config/schema.ts`: appended a new "Session persistence" `CONFIG_SPEC` group
  immediately after the existing "Memory / RAG" group (right before the
  "Verification / anti-hallucination" comment), containing one entry:
  ```typescript
  // --- Session persistence (src/session/*, Slice 30b Phase 6) ---
  {
    env: 'AGENT_SESSIONS_PATH',
    kind: 'string',
    def: 'sessions',
    doc: 'Directory for the session/chat-history SQLite store (session/store.ts createSessionStore), mirroring AGENT_MEMORY_PATH.',
  },
  ```
  This is picked up automatically by the existing generic `loadConfig()` loop — no new
  code path was added.
- `tests/config/schema.test.ts`: appended 2 new test cases after the 4 pre-existing ones
  (all 4 preserved unchanged, verified by reading the file before editing):
  - `'AGENT_SESSIONS_PATH defaults to "sessions" (Slice 30b Phase 6)'`
  - `'AGENT_SESSIONS_PATH honors an env override (Slice 30b Phase 6)'`
  One deviation from the brief's literal snippet: the env-override test's `loadConfig({ AGENT_SESSIONS_PATH: '/tmp/custom-sessions' })` call was wrapped onto 3 lines instead of 1, to satisfy Biome's line-length formatting rule. Purely cosmetic — same call, same assertions.

## TDD evidence

**RED** (`bun test tests/config/schema.test.ts`, before the schema change):
```
4 pass
2 fail
142 expect() calls
```
Both new `AGENT_SESSIONS_PATH` cases failed with `values.AGENT_SESSIONS_PATH` = `undefined` (no such `CONFIG_SPEC` entry yet); all 4 pre-existing tests passed.

**GREEN** (same command, after adding the `CONFIG_SPEC` entry):
```
6 pass
0 fail
146 expect() calls
```

**Regression** (`bun test tests/config/` — full config suite):
```
9 pass
0 fail
156 expect() calls
Ran 9 tests across 2 files.
```
No other `CONFIG_SPEC` entry's coercion was affected.

## Gate (all three, before commit)

- `bun run typecheck` — clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- src/config/schema.ts tests/config/schema.test.ts` — initially flagged one formatting issue (the env-override test line exceeded Biome's line-length limit); fixed by wrapping the `loadConfig({...})` call onto 3 lines. Re-ran: clean, 0 errors.
- Focused test: `bun test tests/config/schema.test.ts` — 6 pass, 0 fail (see GREEN above).
- Full config suite regression: `bun test tests/config/` — 9 pass, 0 fail (see above).

## Files changed

- `src/config/schema.ts` (modified — appended new group + 1 `CONFIG_SPEC` entry, 7 lines)
- `tests/config/schema.test.ts` (modified — appended 2 new test cases, net +9 lines after formatting fix)

## Commit

`9a1679a feat(config): add AGENT_SESSIONS_PATH knob (Phase 6 Incr 1)`

Pre-commit hook (`docs-check`) passed: "living docs present + linked; every src subsystem documented." Only the two intended files were staged/committed (verified via `git status --short` before commit — numerous other unstaged repo changes from prior/parallel task work were left untouched).

## Self-review

- Entry shape mirrors the existing `AGENT_MEMORY_PATH` entry exactly (`kind: 'string'`, `def` a bare relative directory name, no hardcoded absolute path) — honors the repo's "never hardcode limits, env-fallback-only" rule and the "Memory / RAG" precedent it's explicitly modeled on.
- No new code path introduced: relies entirely on the existing generic `loadConfig()` loop, plus the pre-existing `'every entry has a doc string and a default'` test which already covers this new entry (non-empty `doc`, defined `def`) without any test change needed for it.
- The `doc` string forward-references `session/store.ts createSessionStore` (Tasks 4–8 of this phase, not yet built) — intentional per the brief; the config knob is designed to land ahead of its consumer.
- Anchor was verified by reading the live file rather than trusting brief line numbers — the "Memory / RAG" group's last entry (`AGENT_MEMORY_RERANK`) and the following "Verification / anti-hallucination" comment were confirmed present and adjacent before inserting between them.
- Verified the existing test file contained exactly the 4 tests the brief described (no extra pre-existing tests were at risk of being dropped by treating the brief's snippet as "full file content").

## Concerns

None. Scope was a single, isolated `CONFIG_SPEC` entry (YAGNI honored, one entry only) with no downstream code yet depending on it.

## Note

This file previously held a report for an earlier Phase 5 Task 3 (Proposal + BuildResult DTOs, commit `eac5290`), which itself had overwritten a still-earlier Task 3 (Workflow DTOs, commit `c650c17`) and an even earlier one (RunListQuery/RunListResponse, commits `70ced40` + `0956bc4`). Per the established pattern, this report fully overwrites that prior content for the current Phase 6 Task 3 — the earlier work already landed under its own commits and is unaffected by this document overwrite.
