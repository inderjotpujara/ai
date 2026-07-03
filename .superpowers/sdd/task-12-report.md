# Task 12 report (Slice 18, WS3): MLX opt-in runtime selection with degrade-to-Ollama

NOTE: this file previously held a stale report from an unrelated task (a
Slice-13 "live MiniCheck test" task that reused the `task-12` filename under a
different slice's numbering). Replaced below with the correct report for this
Task 12.

## Summary

`src/cli/select-hook.ts` now resolves the declared runtime, and — only for a
**non-Ollama** runtime (e.g. `MlxServer`) — probes `isAvailable()` before
using it. If unreachable, selection degrades to the Ollama runtime, logs a
clear message naming both the unreachable runtime and the fallback, and never
throws. Ollama's own happy path is unchanged: no probe, no behavior change.

## Implementation (`src/cli/select-hook.ts`)

- Added two new optional `SelectHookDeps` fields, following the file's
  existing individually-optional-callback convention (`notify`, `listLoaded`):
  - `runtimeFor?: (kind: RuntimeKind) => Runtime` — overridable runtime
    resolver; defaults to the real `runtimeFor` from `../runtime/registry.ts`
    (imported as `defaultRuntimeFor` to avoid a name clash).
  - `log?: (message: string) => void` — fired only on a degrade; there is no
    generic logger seam in this codebase (confirmed by search: `console.error`
    calls are inline per-file, e.g. `select-runtime.ts`'s `notify` closure),
    so this mirrors that same "optional callback → caller wires it" pattern
    rather than introducing a new logging abstraction.
- Selection logic:
  ```ts
  let rt = resolveRuntime(decl.runtime);
  if (decl.runtime !== RuntimeKind.Ollama && !(await rt.isAvailable())) {
    deps.log?.(`Runtime "${decl.runtime}" is unreachable for model "${decl.model}"; falling back to Ollama.`);
    rt = resolveRuntime(RuntimeKind.Ollama);
  }
  const model = rt.createModel(decl);
  return { model, numCtx: rt.kind === RuntimeKind.Ollama ? numCtx : undefined };
  ```
  Gating `numCtx` on the **resolved** `rt.kind` (not `decl.runtime`) is the
  key correctness point: a degraded-to-Ollama path still needs `numCtx`
  passed through, since it's now actually running on Ollama.
- No auto Apple-Silicon override was added — a `MlxServer` declaration is only
  ever used when the MLX server actually answers; otherwise it silently and
  transparently becomes an Ollama run.

## Production wiring (`src/cli/chat.ts`, `src/cli/select-runtime.ts`)

Both real call sites already wire a `notify` closure to `console.error(...)`
for selection notices. I extended both with `log: (message) =>
console.error(message)` so the degrade message introduced here is actually
visible to a real user, not just observable in tests — leaving it unwired
would have made "log it" true only in the type system. This is a one-line
addition per file, matching the existing convention exactly. Confirmed via a
subagent code search that this is the only existing user-facing logging
pattern in the CLI layer (no shared `Logger`/`main.ts`); OpenTelemetry
(`recordModelSelect` etc.) is the separate structured-telemetry channel and
was left as-is.

## Tests (`tests/cli/select-hook.test.ts`)

Added a `fakeRuntime(kind, available)` stub builder (implements the full
`Runtime` shape so `deps.runtimeFor` can be overridden without touching a live
server) and:

1. **Updated** the pre-existing MLX test (previously relied on the *real*
   singleton `mlxServerRuntime`, silently passing before this change only
   because `isAvailable()` was never called). Confirmed via RED run that it
   now fails without an injected stub (`mlxServerRuntime.isAvailable()`
   returns `false` in this sandbox — no live MLX server — causing an
   unintended degrade and `numCtx: 8192` where the test expected `undefined`).
   Fixed by injecting `runtimeFor: (kind) => fakeRuntime(kind, true)`; renamed
   to make the "MLX available → no degrade" case explicit, and asserts
   `log` was never called.
2. **New**: MLX unavailable → degrades to Ollama. Injects `runtimeFor` so only
   `RuntimeKind.Ollama` reports available; asserts `pre.model` is truthy (no
   throw), `numCtx` is `8192` (Ollama's, passed through post-degrade), `log`
   was called exactly once, and the message names both `MlxServer` and
   `Ollama`.

RED confirmed first (ran the suite before writing the fix — the pre-existing
MLX test failed exactly as described above, which stood in for the "before"
state since the brief's new degrade test doesn't compile until the `log`/
`runtimeFor` deps exist). GREEN confirmed after implementing.

## Verification

- `bun run typecheck` → clean, 0 errors (whole repo).
- `bun run test:file -- "tests/cli/select-hook.test.ts"` → **5 pass, 0 fail**,
  14 `expect()` calls.
- Additionally ran (scoped, not the full suite) `tests/cli/select-runtime.test.ts`
  and `tests/cli/run-chat.test.ts` since I touched those two files for the
  `log` wiring — **5 pass, 0 fail**, 11 `expect()` calls.
- Did not run the full `bun test` suite per instructions (caller runs it after
  commit).

## Files touched

- `src/cli/select-hook.ts` — degrade logic + new optional deps.
- `src/cli/select-runtime.ts` — wire `log` to `console.error`.
- `src/cli/chat.ts` — wire `log` to `console.error`.
- `tests/cli/select-hook.test.ts` — fake-runtime stub + updated/added tests.

## Concerns

- No architecture-doc update was made for this change — it's an internal
  selection-hook behavior change (opt-in + degrade), not a new subsystem or a
  changed data-flow edge in `docs/architecture.md`; the MLX runtime and its
  opt-in nature are already documented there from an earlier slice. Flagging
  this call for the slice's final doc-accuracy review rather than silently
  assuming it's out of scope.
- Left all other modified files in the working tree (`.remember/`,
  `.superpowers/sdd/task-*-brief.md` etc. from sibling task agents running in
  parallel) untouched and unstaged — this commit is scoped to the four files
  above.
