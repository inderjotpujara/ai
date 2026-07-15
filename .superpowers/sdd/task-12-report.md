# Task 12 report (Slice 30b Phase 3 — Runs): @visx deps + `--color-danger` token

*(Note: this filename previously held a Phase-2 Task 12 report for a
differently-scoped task — "feat(web): fetch-based SSE ChatTransport adapter."
Per that report's own stated convention, per-slice Task-N reports share the
same filename and each new slice/phase's Task 12 report replaces the last.
This report covers the current Phase-3 Task 12: @visx charting deps +
`--color-danger` design token, the first web-layer task of Phase 3.)*

**Status:** DONE

**Commit:** `ce5f5ba42e3174132cdd8e7afca940e3d1f219a3` — "chore(web): add @visx
(scale/shape/axis/group/tooltip) + --color-danger token"

## What was done

1. **Installed deps** — `cd web && bun add @visx/scale @visx/shape @visx/axis
   @visx/group @visx/tooltip`. Bun resolved all five to **`4.0.0`** (current
   major at install time):
   - `@visx/scale@4.0.0`
   - `@visx/shape@4.0.0`
   - `@visx/axis@4.0.0`
   - `@visx/group@4.0.0`
   - `@visx/tooltip@4.0.0`

   No `@xyflow` package was added, per design decision D1 (waterfall view is
   @visx-only).

2. **Wrote the failing test first** (TDD RED) — the `web` package already had
   a `tokens.test.ts` from an earlier task with existing `describe` blocks, so
   the brief's exact test snippet was **appended** as a new `describe('design
   tokens', ...)` block rather than overwriting the file. Ran
   `bun run test src/shared/design/tokens.test.ts` → confirmed RED: 1 failed
   (`--color-danger` not found), 4 pre-existing tests still passed.

3. **Minimal impl** (TDD GREEN) — added to
   `web/src/shared/design/tokens.css`:
   - dark `:root { ... }` block: `--color-danger: #F0616D;`
   - light `:root:where(.light) { ... }` block: `--color-danger: #D22B3A;`

   Re-ran the test → GREEN: 5/5 passed.

## Gate results

- `cd web && bun run test src/shared/design/tokens.test.ts` → **PASS**, 5/5
  tests (1 new + 4 pre-existing), ~360ms.
- `cd web && bun run typecheck` → **clean** (`tsc --noEmit`, no output).
- `cd web && bun run build` → **succeeds** (`vite build`, 704 modules
  transformed, built in 318ms) — proves the five new @visx deps resolve and
  install correctly under the workspace's Vite/Rolldown build. Only output
  was the pre-existing "chunk larger than 500kB" advisory (unrelated to this
  change, not a new regression).
- Root `bun run lint:file -- "web/src/shared/design/tokens.css"
  "web/src/shared/design/tokens.test.ts"` → **does cover web files**
  (`biome check`, root-scoped). First run flagged one formatter-only issue:
  the appended test's `const dark = css.slice(...)` line exceeded Biome's
  line-width limit. Reformatted to a multi-line call; re-ran → clean, 0
  errors.

## Lockfile

Only a **root `bun.lock`** exists for this repo (no separate `web/bun.lock` —
confirmed by `ls web/bun.lock` returning "No such file or directory" before
the install). `bun add` inside `web/` updated the root `bun.lock` in place, so
the commit includes `bun.lock` (repo root), not `web/bun.lock` as the brief's
Step 6 example commit assumed. This matches how the workspace is actually set
up (single lockfile for the whole `bun` workspace).

## Files changed (commit `ce5f5ba`)

- `web/package.json` — added the five `@visx/*` deps.
- `bun.lock` (root) — lockfile update for the new deps (60 packages
  installed/resolved as transitive deps of the five @visx packages).
- `web/src/shared/design/tokens.css` — `--color-danger` added to both the
  dark `:root` and light `:root:where(.light)` blocks.
- `web/src/shared/design/tokens.test.ts` — new `describe('design tokens', ...)`
  block appended (existing tests/blocks left untouched).

Staged explicitly by path (`git add web/package.json bun.lock
web/src/shared/design/tokens.css web/src/shared/design/tokens.test.ts`), not
`-A` — verified via `git status --short` before commit that no other
repo-wide in-flight changes (`.superpowers/sdd/*`, `.remember/*`, the
Phase-3 plan doc) were swept in.

## Concerns

- **Lockfile location differs from the brief's Step 6 literal command**
  (`git add ... web/bun.lock ...`) — there is no `web/bun.lock`; the correct
  file is the root `bun.lock`. Flagging in case downstream tooling/scripts
  assume a per-workspace lockfile.
- The pre-existing `tokens.test.ts` file (from an earlier task) was extended
  rather than replaced — worth a quick sanity check that no later task
  expects this file to contain *only* the brief's snippet.
- Chunk-size build warning (`>500kB` minified JS) is pre-existing and
  unrelated to @visx (the five packages are small); not something this task
  introduced, not addressed here.
