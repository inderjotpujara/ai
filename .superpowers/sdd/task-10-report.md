# Task 10 report: transpiler↔engine round-trip contract test

**Status:** DONE (with one documented deviation from the brief's sample code — a test-harness placement issue, not a Task 9 transpiler defect).

## What was written

`tests/crew-builder/transpile-contract.test.ts` — two tests, no new source:

1. **Workflow round-trip**: builds a valid `WorkflowIR` (tool step `f` → agent step `a` depending on it), calls `transpile(ir, 'workflow')`, writes the generated TS to a temp file, `await import()`s it, asserts `mod.default.id === 'ct'` and `mod.default.steps.length === 2`.
2. **Crew round-trip**: builds a valid `CrewIR` (2 members, 2 tasks with a `dependsOn` edge), calls `transpile(ir, 'crew')`, same import + assert pattern (`mod.default.id === 'ct_crew'`, `mod.default.members.length === 2`).

Both rely on the generated module's top-level `defineWorkflow(...)` / `defineCrew(...)` call throwing at import time if the graph were invalid (duplicate ids, dangling deps, cycles, unknown branch targets, unknown task member) — so a clean `await import()` **is** the round-trip proof that Task 9's transpiler emits a graph the engine accepts.

## Import-path resolution — deviation from the brief's literal sample

The brief's sample used `mkdtempSync(join(process.cwd(), 'workflows', '.tmp-'))` then `join(dir, 'gen.ts')`. I implemented this literally first and it **failed**:

```
error: Cannot find module '../src/workflow/define.ts' from '/Users/inderjotsingh/ai/workflows/.tmp-EnIIkg/gen.ts'
error: Cannot find module '../src/core/types.ts' from '/Users/inderjotsingh/ai/crews/.tmp-wWr7rI/gen.ts'
```

Root cause: `mkdtempSync` creates a **subdirectory** inside `workflows/`, so the generated file ends up at `workflows/.tmp-XXXXXX/gen.ts` — depth 2 from repo root. But the transpiler emits `'../src/...'` imports designed for depth 1 (`workflows/<id>.ts`, one hop up to repo root). One `../` from depth 2 only reaches `workflows/`, not repo root, so the module can't be found.

This is **not a Task 9 transpiler bug** — the emitted `'../src/...'` paths are correct for the transpiler's documented contract (files live directly under `crews/`/`workflows/`, i.e. depth 1). The bug was in the brief's own sample test-harness code, which introduces an extra nesting level via `mkdtempSync`.

**Fix applied:** instead of `mkdtempSync` (which always creates a directory), the test writes a uniquely-named file (`crypto.randomUUID()`) directly as a sibling of the real generated modules — `workflows/.tmp-<uuid>.ts` / `crews/.tmp-<uuid>.ts` — staying at the required depth-1. Cleanup is `rmSync(file, { force: true })` for the single file, in a `try/finally`, instead of a recursive directory removal (there's no directory to remove).

## Evidence

```
$ bun test tests/crew-builder/transpile-contract.test.ts
 2 pass
 0 fail
 4 expect() calls

$ bun test tests/crew-builder/
 32 pass
 0 fail
 55 expect() calls
Ran 32 tests across 9 files.

$ ls workflows/ crews/ | grep tmp   # empty — no stray temp files after run

$ bun run typecheck
$ tsc --noEmit   (clean, no output)

$ bun run lint:file -- tests/crew-builder/transpile-contract.test.ts
$ biome check tests/crew-builder/transpile-contract.test.ts
Checked 1 file in 3ms. No fixes applied.
```

The generated workflow and crew TS source both imported and executed `defineWorkflow`/`defineCrew` cleanly, proving Task 9's transpiler output is valid, importable TypeScript that the runtime engine accepts as-is.

## Files touched
- `tests/crew-builder/transpile-contract.test.ts` (new, 88 lines)

## Commit
`6cf2ddc` — `test(crew-builder): transpiler<->engine round-trip contract`

## Concerns
- None for Task 9's transpiler — it emits correct, importable source.
- Worth a note for whoever writes the CLI/orchestrator that actually places generated files in Slice 19: confirm it writes to `crews/<id>.ts` / `workflows/<id>.ts` directly (depth 1), not into a nested subdirectory, or the same import-path mismatch will occur at runtime.
