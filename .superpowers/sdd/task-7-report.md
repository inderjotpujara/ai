## Task 7 report: real deps + `bun run agent-builder` CLI + chat gap-offer (Slice 17)

**Commit:** `05b4c1e` — feat(agent-builder): real deps + bun run agent-builder CLI + TTY gap-offer in chat (Slice 17 Task 7)

### Files changed
- Created `src/agent-builder/deps.ts` — `makeBuilderModel(model, numCtx?, generateImpl = generateObject)` (injectable structured-generation seam) and `makeRealBuilderDeps({ autoYes? })` (assembles live `BuilderDeps`: resolves a tools-capable, largest-that-fits model via `buildRegistry()` → `createModelManager()` → `resolveModel({role,requires:[Capability.Tools],prefer:PreferPolicy.LargestThatFits}, registry, {ensureReady, listLoaded})` → `runtimeFor(decl.provider).createModel(decl)`; wires `agentNames()`, `STARTER_PACK` names, a stderr-rendered consent prompt via `askYesNo`, default fs paths (`agents/`, `agents/index.ts`, `defaultConfigPath()`), and `log` to `console.error`; returns `cleanup: () => manager.unloadAll()`).
- Created `src/cli/agent-builder.ts` — parses `--yes`/`-y` + positional need string, usage error (exit 1) on empty need, calls `buildAgent`, prints outcome per `BuildResult.kind` (written/declined/invalid/abandoned), `finally { await cleanup(); }`, guarded by `if (import.meta.main)`.
- Modified `src/cli/chat.ts` — gap branch keeps `console.log(result.message)`, then only when `interactiveTTY()` is true, prompts `askYesNo` (mandatory, `autoYes: false`) to propose a new agent; on yes, calls `makeRealBuilderDeps()` (no autoYes) → `buildAgent(missingCapability + ". Original task: " + task, deps)` → `finally cleanup()`; non-TTY path is unchanged (only the message logs).
- Modified `package.json` — added `"agent-builder": "bun run src/cli/agent-builder.ts"` after the `"mcp"` script line.
- Created `tests/agent-builder/deps.test.ts` — the `makeBuilderModel` wrapper test from the brief, injecting a fake `generateObject`-shaped function so no live model is needed.

### The autoYes simplification applied
The brief flagged its own sample `confirm` implementation in `deps.ts` as convoluted:
```ts
autoYes: opts.autoYes === true && !interactiveTTY() ? false : opts.autoYes === true
```
Replaced, as directed, with the simple form:
```ts
confirm: (text) => {
  process.stderr.write(`${text}\n`);
  return askYesNo('Create this agent?', { input, autoYes: opts.autoYes === true });
},
```
`--yes` alone drives `autoYes` for the standalone CLI (tests/automation). `interactiveTTY` is not imported in `deps.ts` at all — TTY-gating for the *gap-offer* lives in `chat.ts`, where `makeRealBuilderDeps()` is called with no `autoYes` at all, keeping consent mandatory on that path.

### TDD: RED → GREEN
RED (module not found, as expected):
```
$ bun test tests/agent-builder/deps.test.ts
error: Cannot find module '../../src/agent-builder/deps.ts' from '/Users/inderjotsingh/ai/tests/agent-builder/deps.test.ts'
0 pass / 1 fail / 1 error
```
GREEN after implementing `deps.ts`:
```
$ bun test tests/agent-builder/deps.test.ts
1 pass
0 fail
1 expect() calls
Ran 1 test across 1 file. [112.00ms]
```

### Gate results (final, all green)
- `bun test tests/agent-builder/deps.test.ts tests/cli/` → **33 pass, 0 fail, 72 expect() calls** across 11 files (confirms `chat.ts` wiring still compiles and existing CLI tests are unaffected).
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- "src/agent-builder/deps.ts" "src/cli/agent-builder.ts" "src/cli/chat.ts" "tests/agent-builder/deps.test.ts"` → initially flagged pure Biome formatting diffs (line-wrapping/multi-line arg lists); fixed via `bunx biome check --write` on the same four files; reconfirmed clean: `Checked 4 files in 4ms. No fixes applied.`
- `bun run docs:check` → `✔ docs-check: living docs present + linked; every src subsystem documented.` (the `agent-builder` subsystem was already documented by earlier tasks in this slice; this task's wiring-only diff needed no `architecture.md` change).

### Concerns / follow-ups
- None blocking. The gap-offer path in `chat.ts` and the standalone CLI both depend on a live tools-capable model being resolvable via the registry — not exercised end-to-end against a real Ollama/model-manager in this task (per the brief, only the light `makeBuilderModel` wrapper unit is tested here). Live-model integration is expected at the slice's live-verify-before-merge gate, not per-task.
- The gap-offer's "re-run your task to use it" message is intentional per the brief — the newly built agent is not auto-retried in the same session.

---

## Live-verify fix: `generateObject` → `generateText` + JSON-extract + zod (Slice 17)

**Commit:** `<see final commit hash below>` — fix(agent-builder): use generateText+JSON-extract+zod instead of generateObject (local models emit non-strict JSON) — live-verify fix (Slice 17)

### Root cause
The above task's `makeBuilderModel` used the AI SDK's `generateObject`, which relies on the underlying provider's native structured-output/JSON mode. Against local Ollama models this mode is unreliable: running the live-verify command (`bun run agent-builder "read and answer questions about PDF files in this repo" --yes` against `qwen3.5:9b`) failed with `AI_JSONParseError: JSON parsing failed` — the model returned YAML-ish `key: value` text (`pdf_qna_agent: ...\nsystem_prompt: ...\nrole_label: ...`) that didn't even use the schema's real keys, rather than a JSON object `generateObject` could parse. This is exactly the failure mode the repo's verification subsystem already solved: `src/verification/deps.ts`'s `generate()` uses plain `generateText`, and `src/verification/claims.ts`'s `extractJson` strips a ` ```json ` fence and slices to the outermost bracket before `JSON.parse`.

### Fix
Reimplemented `makeBuilderModel` in `src/agent-builder/deps.ts` on the same proven pattern, keeping the `BuilderModel.object` seam interface unchanged (so `generate.ts`/`suggest-tools.ts` and their tests needed zero changes):
1. Swapped the import from `generateObject` to `generateText` (both from `ai`); `z` is now imported as a value (not `import type`) so `args.schema instanceof z.ZodObject` can be checked at runtime.
2. `object<T>({ schema, prompt })` derives expected keys when the schema is a `z.ZodObject` (`Object.keys(schema.shape)`) and appends a strict instruction to the prompt (`Respond with ONLY a JSON object (no markdown fences, no commentary) using EXACTLY these keys: <keys>.`), omitting the key list otherwise.
3. Calls `generateTextImpl({ model, prompt: <augmented>, ...(providerOptions ? { providerOptions } : {}) })` — `providerOptions` still comes from `ollamaCtxOptions(numCtx)` exactly as before.
4. A local `extractJson` (mirrors `src/verification/claims.ts`: strips a ` ```json `/` ``` ` fence, slices from the first `{` to the last `}`) feeds `JSON.parse`, then `schema.parse(parsed)` (zod, throws on shape mismatch) via a small `parseAgainst` helper.
5. On parse/validation failure, retries **once** with an added `The previous response was not valid JSON. Return ONLY the JSON object, nothing else.` reminder; if the retry also fails it throws `Error('agent-builder: model did not return valid JSON for the proposal')`.
`makeRealBuilderDeps` still calls `makeBuilderModel(model, numCtx)` unchanged.

### Test changes (`tests/agent-builder/deps.test.ts`)
Replaced the single fake-`generateObject` test with four cases against a fake `generateTextImpl`:
1. Plain JSON text (`'{"servers":["fetch"]}'`) → parses to `{ servers: ['fetch'] }`.
2. ` ```json `-fenced JSON → same result (fence-stripping path).
3. First call returns YAML-ish garbage, second call returns valid JSON → proves the one-retry path succeeds (`call` counter asserts exactly 2 invocations).
4. Both calls return garbage → `model.object(...)` rejects with the `agent-builder: model did not return valid JSON for the proposal` error.

### RED → GREEN
Pre-fix, the live command reproduced exactly the reported error:
```
$ bun run agent-builder "read and answer questions about PDF files in this repo" --yes
AI_JSONParseError: JSON parsing failed
```
Post-fix, `bun test tests/agent-builder/` → **35 pass, 0 fail, 61 expect() calls** across 7 files.

### Live RE-VERIFY (real Ollama, `qwen3.5:9b`)
```
$ bun run agent-builder "read and answer questions about PDF files in this repo" --yes
Proposed agent: repo_pdf_qa_agent
  Routes queries regarding reading and answering questions about PDF files stored within this repository.
Why: This agent focuses exclusively on parsing repository-hosted PDF documents to provide accurate answers derived solely from their textual data.
Tools (MCP servers to mount):
  • file-tools (scoped to repo_pdf_qa_agent)
Files that will be written: agents/repo_pdf_qa_agent.ts, agents/index.ts, mcp.json
Created agent "repo_pdf_qa_agent" (3 file(s)). It is live on the next run.
Created agent "repo_pdf_qa_agent". Files: agents/repo_pdf_qa_agent.ts, agents/index.ts, /Users/inderjotsingh/ai/mcp.json
It is live on your next run. Its MCP server (if any) is consent-gated on first mount.
```
Confirmed: `agents/repo_pdf_qa_agent.ts` was a well-formed TS module (valid `createRepoPdfQaAgentAgent` factory), `agents/index.ts` gained a correct import + registry entry, and `mcp.json` gained a `repo_pdf_qa_agent` entry scoped onto the existing `file-tools` server. **`bun run typecheck` was clean with the generated file present** (`tsc --noEmit`, no output) before cleanup.

### Demo-artifact cleanup (post-verify)
Per instructions, the live-verify run's output is a demo, not a slice deliverable. Reverted with `git checkout -- agents/index.ts mcp.json && rm agents/repo_pdf_qa_agent.ts`. `git status` afterward showed only `src/agent-builder/deps.ts` and `tests/agent-builder/deps.test.ts` as intentional changes (plus pre-existing, unrelated working-tree modifications from before this fix task started — untouched).

### Gate results (final, all green)
- `bun test tests/agent-builder/` → **35 pass, 0 fail, 61 expect() calls** across 7 files.
- `bun run typecheck` → clean (`tsc --noEmit`, no output) — checked both with and without the live-verify-generated agent file present.
- `bun run lint:file -- "src/agent-builder/deps.ts" "tests/agent-builder/deps.test.ts"` → initial Biome formatting diffs (line-wrapping on multi-arg calls), fixed via `bunx biome check --write` on the same two files; reconfirmed clean: `Checked 2 files in 4ms. No fixes applied.`
- Live end-to-end run against real Ollama (`qwen3.5:9b`) succeeded — this was the actual bug repro and is now the regression guard for the fix.
