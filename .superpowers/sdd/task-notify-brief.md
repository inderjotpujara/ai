# Task: notify-model-store

## Goal
At runtime the CLI must NOTIFY the user that the agent is using models from THIS PROJECT's local store (`./model-images`), not Ollama's global store (`~/.ollama`). If it detects the project store is NOT active (the user started the global menu-bar Ollama instead of `bun run serve`), it must WARN them to run `bun run serve`.

## Background
- Ollama stores model blobs/manifests under whatever `OLLAMA_MODELS` the SERVER was started with. `scripts/serve.sh` (run via `bun run serve`) sets `OLLAMA_MODELS=<repo>/model-images`. The CLI is only a client and does NOT know the server's path via any API.
- Reliable-enough signal that the project store is the active one: after the model is present/warm, the project store directory contains Ollama's data dirs. So: `./model-images/blobs` (or `./model-images/manifests`) exists. If neither exists, the active server is using a different (global) store.
- Resolve the project store relative to `process.cwd()` (the project already does this — e.g. `runsRoot: 'runs'` in `src/cli/chat.ts` uses cwd). Use `join(process.cwd(), 'model-images')`.
- Progress/info in `chat.ts` goes to STDERR (`console.error`); stdout is reserved for the agent's answer (`console.log`). The notice MUST go to stderr.

## Implement (TDD — write tests FIRST, watch them fail, THEN implement)

### 1. New file `src/resource/model-store.ts` (pure, no network)
- `projectStorePath(): string` → `join(process.cwd(), 'model-images')`.
- `isProjectStoreActive(storePath?: string): boolean` → returns `true` if `storePath` (default `projectStorePath()`) contains a `blobs` OR `manifests` subdirectory (use `node:fs` `existsSync`). Default param so callers can omit it; tests pass an explicit temp path.

### 2. Test `tests/resource/model-store.test.ts` (TDD)
Using a temp dir (`mkdtemp`/cleanup with `rm -rf`):
- empty dir → `isProjectStoreActive(dir)` is `false`
- dir with a `blobs` subdir created → `true`
- dir with a `manifests` subdir created → `true`
- `projectStorePath()` ends with `model-images` (optional but do it)

### 3. Wire into `src/cli/chat.ts`
AFTER the model is ensured-present and warmed (after the `warmModel(...)` call), before/around running the agent, emit to stderr:
- if `isProjectStoreActive()` → `console.error('Using project-local models from ./model-images')`
- else → `console.error('⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.')`

Do NOT change stdout. Do NOT change other behavior.

## Exact notice strings (verbatim)
- Active: `Using project-local models from ./model-images`
- Inactive: `⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project's local models.`

## Code style constraints
- `type` over `interface`; `enum` over string literal unions for finite named sets
- Early returns over nested conditionals
- No `!` non-null assertions — use optional chaining if needed
- No `console.log` left in (use `console.error` for stderr output per existing pattern)
- Single-responsibility files

## Verification (ALL must pass)
```
bun run test:file -- ./tests/resource/model-store.test.ts   # passes
bun run typecheck                                             # exit 0
bun run lint                                                  # exit 0 (biome deprecation NOTICE ok, no errors)
bun test                                                      # all pass
```

## Commit message (exact)
`feat(cli): notify when using project-local model store (./model-images)`

## Report file
Write full report (TDD evidence RED+GREEN, files changed, exact notice strings, self-review) to:
`/Users/inderjotsingh/ai/.superpowers/sdd/task-notify-report.md`
