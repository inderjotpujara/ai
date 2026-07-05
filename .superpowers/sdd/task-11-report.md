# Task 11 Report: Migrate verified-build withWallClock + runtime probe literals (Slice 21)

*(Note: this path previously held a stale Slice-19 report — "CrewMember.agentRef
+ crew-engine resolution" — for a differently-numbered Task 11. Overwritten here
per the file-reuse convention that report itself documented.)*

**Status:** DONE.

## Files changed

- `tests/reliability/timeout-reexport.test.ts` (new) — asserts `verified-build/dry-run.ts`'s
  `withWallClock` is (`toBe`) the same function reference as `reliability/timeout.ts`'s.
  Confirmed it FAILED before the migration (two distinct `[Function: withWallClock]`
  instances — Bun's `toBe` diff showed both) and PASSES after.
- `src/verified-build/dry-run.ts` — deleted the local `withWallClock` body; replaced with
  `export { withWallClock } from '../reliability/timeout.ts';`. Kept the doc comment above
  it, updated to reference `Error('timeout')` instead of the old `'dry-run timeout'`.
- `src/runtime/ollama.ts` — imported `probeTimeoutMs` from `../reliability/config.ts`;
  replaced `AbortSignal.timeout(1500)` in `isAvailable()` with
  `AbortSignal.timeout(probeTimeoutMs())`.
- `src/runtime/mlx-server.ts` — imported `probeTimeoutMs` from `../reliability/config.ts`;
  replaced both `AbortSignal.timeout(1500)` occurrences (in `listModels()` and
  `isAvailable()`) with `AbortSignal.timeout(probeTimeoutMs())`.
- `tests/verified-build/dry-run.test.ts` — updated the one test that asserted the exact
  rejection message.

## Test message updated (detail, not regression)

`tests/verified-build/dry-run.test.ts` had:
```ts
test('rejects with dry-run timeout when fn never settles', async () => {
  await expect(
    withWallClock(10, () => new Promise<never>(() => {})),
  ).rejects.toThrow('dry-run timeout');
});
```
Reliability's `withWallClock` rejects `new Error('timeout')`, not `'dry-run timeout'` — this
is the documented, intentional message change called out in the task brief (Step 3), not a
behavioral regression: the wall-clock race semantics (still rejects when `fn` never settles,
still resolves with `fn`'s value when it finishes in time) are unchanged. Updated the test
name and assertion:
```ts
test('rejects with timeout when fn never settles', async () => {
  await expect(
    withWallClock(10, () => new Promise<never>(() => {})),
  ).rejects.toThrow('timeout');
});
```
Grepped `tests/verified-build/`, `tests/runtime/`, `tests/cli/`, and `src/` for both the
literal `'dry-run timeout'` string and the probe-timeout literal `1500`/`1_500` before and
after the change — this was the only hit; no other test asserted either literal.

## Test results

```
$ bun test tests/reliability/timeout-reexport.test.ts tests/verified-build/ tests/runtime/ tests/cli/
168 pass, 0 fail, 378 expect() calls across 31 files
```

`bun run typecheck` — clean (`tsc --noEmit`, no output).
`bun run lint:file -- src/verified-build/dry-run.ts src/runtime/ollama.ts src/runtime/mlx-server.ts tests/verified-build/dry-run.test.ts tests/reliability/timeout-reexport.test.ts`
— clean ("Checked 5 files in 34ms. No fixes applied.").

## Concerns

None. No test in the runtime/CLI suites asserted the old `1500` literal, so the
`probeTimeoutMs()` migration was a pure drop-in (default is still 1500ms via the
`AGENT_PROBE_TIMEOUT_MS` env fallback in `reliability/config.ts`, unchanged behavior at
runtime). The re-export identity test gives a durable regression guard against a future
accidental re-divergence of the two `withWallClock` implementations.

Staging note: several unrelated files (`.superpowers/sdd/task-*-brief.md`/`task-*-report.md`,
`.remember/today-2026-07-05.md`, `.superpowers/sdd/progress.md`) were modified in the working
tree by concurrently-running sibling task agents sharing this same working tree (no worktree
isolation). I staged and committed **only** this task's 5 files by explicit path
(`git add src/verified-build/dry-run.ts src/runtime/ollama.ts src/runtime/mlx-server.ts
tests/verified-build/dry-run.test.ts tests/reliability/timeout-reexport.test.ts` then
`git commit` with nothing else staged) — verified via `git status --short` immediately before
committing that the index held exactly those 5 paths. Commit `4f35f0a`'s diff is scoped to
this task only.

## Commit

`4f35f0a` — "refactor: migrate withWallClock + probe timeouts onto reliability module"
