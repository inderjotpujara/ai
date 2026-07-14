# Task 5 Report: Config — `ConfigEntry.strict?` flag + server (`AGENT_WEB_*`) entries

## Status: DONE

## Note on this file
This overwrites a stale `task-5-report.md` from an unrelated earlier
Slice-30a Ops Surface task ("Top-level error boundary + persisted
error.json"), which had the same filename due to per-slice task numbering.
That content is preserved in git history (prior commit `06fbc05` touching
this path). This report covers the actual current Task 5 (Slice 30b Phase 1,
config schema for the web BFF).

## Commit
`e18db5c56b403d6034472c33edd10ebf87fd99f8` — feat(config): add ConfigEntry.strict flag + AGENT_WEB_* server entries

## Implemented

Followed the brief's TDD steps exactly, working on branch `slice-30b-local-web-ui` (already checked out, no new branch cut).

1. **Wrote the failing test** `tests/config/web-config.test.ts` (verbatim from brief) — 3 tests covering entry existence/defaults, the `strict` flag, and `loadConfig` behavior (default + env override for both the new `AGENT_WEB_PORT`/`AGENT_WEB_RECORD_IO` and confirming the two pre-existing strict booleans).
2. **Ran RED**: `bun test tests/config/web-config.test.ts` → 3 fail (undefined `.def`/`.strict` as expected since `AGENT_WEB_*` entries didn't exist yet).
3. **Edited `src/config/schema.ts`** (three precise edits, no other lines touched):
   - Added optional `strict?: boolean` to `ConfigEntry` type, with the exact doc comment from the brief.
   - Added `strict: true` to the existing `AGENT_PROVISION_AUTO_YES` entry (in the "Provisioning" group) — preserved its existing `doc`/`def` verbatim, only appended the field.
   - Added `strict: true` to the existing `AGENT_MCP_AUTO_APPROVE` entry (in the "MCP" group) — same, preserved verbatim, only appended the field.
   - Appended a new `// --- Server / web BFF (Slice 30b) ---` group of three entries (`AGENT_WEB_PORT` num/4130, `AGENT_WEB_ORIGIN_ALLOWLIST` string/`'http://localhost,http://127.0.0.1'`, `AGENT_WEB_RECORD_IO` bool/false/`strict: true`) immediately before the closing `];` of `CONFIG_SPEC`.
   - `coerce`/`loadConfig` were **not** touched — verified by diff (only additions, zero lines changed in either function).
4. **Ran GREEN**: `bun test tests/config/web-config.test.ts` → 3 pass, 10 expect() calls.
5. **Typecheck**: `bun run typecheck` (`tsc --noEmit`) → clean, no errors.
6. **Existing config tests**: `bun test tests/config` → 7 pass (4 pre-existing in `tests/config/schema.test.ts` + 3 new), 0 fail, 150 expect() calls — confirms no regression to the pre-existing suite.
7. **Extra sanity check** (not in brief but cheap and relevant): ran `bun run config` (the `src/cli/config.ts` dump script referenced in the module's own header doc) and grepped for `AGENT_WEB` — all three new entries render correctly with their docs, confirming the CLI dump path (which iterates `CONFIG_SPEC`) picks up the new group with no extra wiring needed.
8. **Commit**: staged only `src/config/schema.ts` + `tests/config/web-config.test.ts` (repo had other pre-existing modified files from earlier Slice-30b tasks in the working tree — left untouched/unstaged, not part of this task). Pre-commit hook (`docs:check`) passed — no new `src/` subsystem was introduced, `src/config/schema.ts` was already documented in `architecture.md`.

## Test commands + results

```
$ bun test tests/config/web-config.test.ts        # RED (before edit)
3 fail (undefined .def / .strict as expected)

$ bun test tests/config/web-config.test.ts        # GREEN (after edit)
3 pass / 0 fail / 10 expect() calls

$ bun run typecheck
$ tsc --noEmit
(clean, no output = no errors)

$ bun test tests/config
7 pass / 0 fail / 150 expect() calls   (2 files: schema.test.ts + web-config.test.ts)
```

## Self-review

- Diff to `src/config/schema.ts` is exactly the three edits described in the brief — no reformatting, no incidental changes to unrelated entries, `coerce`/`loadConfig` bodies byte-identical apart from the pre-existing surrounding code.
- The two existing boolean entries' `doc`/`def`/`kind` text matched the brief's transcription exactly, so no divergence to reconcile — just appended `strict: true`.
- New group placed at the very end of `CONFIG_SPEC`, after the Voice group, before `];`, matching the brief's "near the end" instruction and following the file's existing `// --- Group name (path) ---` comment convention.
- `AGENT_WEB_ORIGIN_ALLOWLIST` has no `strict` flag (correct — it's a string, not a default-off boolean) and no test asserts on it beyond `kind`, matching the brief.
- No vacuous assertions — all three tests exercise real distinguishing behavior (existence+defaults, strict-flag presence *and* absence on a control case, and end-to-end `loadConfig` coercion with an env override).
- Confirmed via `bun run config` CLI dump (beyond what the brief asked) that the new entries are live and correctly formatted end-to-end, not just visible to the test file's direct import.

## Concerns

None. This was a pure additive, low-risk metadata + spec-table change with no behavior change to `coerce`/`loadConfig`, exactly as scoped. Task 5 unblocks the server-side config consumption in subsequent Slice-30b tasks.
