# Task 9 Report: `@huggingface/transformers` direct dep + Vite worker/optimizeDeps config + isolation-headers.ts comment

Note: this filename was previously used for an unrelated Task 9 from Slice 30b
Phase 5 (builder confirm/log adapter). That content is superseded — this is
Slice 30b Phase 7's Task 9 (Increment 3 close-out: transformers.js dep +
Vite worker config).

## Status: DONE

## Commit
`b9fdea2` — `feat(voice): @huggingface/transformers as a direct web/ dep + Vite worker config (D10)`
(4 files changed: `web/package.json`, `bun.lock`, `web/vite.config.ts`,
`src/server/isolation-headers.ts`)

## Changes

1. **`web/package.json`**: added `"@huggingface/transformers": "^4.2.0"` to
   `dependencies`, alphabetically sorted between `@fontsource-variable/geist-mono`
   and `@tanstack/react-router`, pinned to match root `package.json:43` exactly.
2. **`bun install`** (repo root): re-resolved; lockfile updated, no version
   change (already present at root, now also declared by `web/` directly
   instead of relying on workspace hoisting).
3. **`web/vite.config.ts`**:
   - Updated the `isolation` block's comment per the brief (transformers.js
     threaded WASM, not the rejected sherpa-onnx plan).
   - Added `optimizeDeps.exclude: ['@huggingface/transformers']` per the brief
     verbatim (keeps its WASM/ONNX binaries out of esbuild's dev pre-bundling
     pass).
   - Added `worker: { format: 'es' }` — **not present in the brief's literal
     code snippet**, but added because `stt-engine.ts:31` constructs the
     worker with `new Worker(url, { type: 'module' })`, and `stt.worker.ts`
     statically imports `@huggingface/transformers` (which itself does
     dynamic `import()` for backend selection). Vite's default
     `worker.format` is `'iife'`, which can't express that; leaving it
     unset would mismatch how the worker is instantiated once Part B wires
     it in. Flagged as a deliberate, reasoned addition beyond the brief
     text, not a silent deviation — matches the outer task description's
     explicit call for "worker config (format 'es')".
   - Left COOP/COEP headers untouched (still `require-corp`). Confirmed via
     `stt.worker.ts:1`'s comment that Task 7's D10 spike landed on **Rung 1**
     (require-corp + CDN CORS), matching the brief's default assumption — no
     `credentialless` swap needed.
4. **`src/server/isolation-headers.ts`**: replaced the stale "sherpa WASM
   SharedArrayBuffer" comment with the brief's transformers.js-accurate
   wording, verbatim from Step 2 of the brief. Comment-only change.

## Gate results
- `cd web && bun run typecheck` — PASS (no output/errors)
- `cd web && bun run test` — PASS, **51 test files / 235 tests**, all green
  (some expected `ECONNREFUSED` console noise from a pre-existing test
  hitting a non-running port 3000 — not a failure)
- `cd web && bun run build` — **ran, PASS**, built in 279ms, no errors.
  Note: no separate worker/transformers chunk appears in `dist/` yet because
  `stt-engine.ts` (which references the worker) isn't imported by any app
  component yet — that wiring is Part B (Tasks 10-18). Confirmed via grep
  that only `stt-engine.ts`/`stt.worker.test.ts` reference it, nothing
  reachable from the app entry. Expected at this point in the sequence.
- Root `bun run typecheck` — PASS
- Root `bun run lint` — PASS (exit 0; 18 pre-existing warnings elsewhere in
  the repo — e.g. `tests/server/mcp-add.test.ts`, `tests/server/models-pull.test.ts`
  — none touching files this task modified)
- Pre-commit `docs:check` hook ran clean as part of the commit.

## Self-review
- Diff scope matches the brief's `git add` list exactly: `web/package.json`,
  `bun.lock`, `web/vite.config.ts`, `src/server/isolation-headers.ts`.
- Left numerous unrelated pre-existing modified files (other task
  briefs/reports, `.remember/*`, `progress.md`) untouched/unstaged —
  confirmed via `git status --short` before staging.
- Verified root package.json:43 version string character-for-character
  before pinning `web/package.json`'s entry to it.
- Verified D10 rung (Rung 1 vs 2) empirically from `stt.worker.ts`'s own
  header comment rather than assuming the brief's default — confirmed no
  `credentialless` swap was needed.

## Concerns
- The `worker.format: 'es'` addition is a judgment call beyond the brief's
  literal snippet — reasoning given above. Recommend the controller/reviewer
  double-check it against Part B's live-verify (Task 17/18) once the worker
  is actually wired in and produces a real bundle chunk, to confirm the
  format choice holds up in practice and not just by static inspection.
- This task's `bun run build` passing proves the config is *syntactically*
  and *structurally* sound (transformers.js resolves through Vite's
  bundler as a direct dep, no build errors), but does NOT yet prove the
  worker bundles/loads correctly at runtime — `stt-engine.ts`/`stt.worker.ts`
  are still dead code until Part B wires them into a component. That
  runtime proof is still pending Task 18 live-verify.
