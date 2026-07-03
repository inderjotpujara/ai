# Task 5 report: `writeAgent` — render file + register in index + scope mcp.json (Slice 17)

## What `src/agent-builder/write.ts` does

`writeAgent(proposal, paths)` is the terminal step of the agent-builder
pipeline (Slice 17, Phase D): given a validated `AgentProposal`, it

1. **`renderAgentFile`** — renders a standalone `agents/<name>.ts` source file
   (factory function `create<Name>Agent`, system prompt, model requirement)
   and writes it atomically (`atomicWrite`: write to `<path>.tmp`, then
   `renameSync`).
2. **`registerInIndex`** — inserts an `import { create<Name>Agent } from
   './<name>.ts'` line and a `<name>: create<Name>Agent,` registry entry into
   `agents/index.ts` at the `// AGENT-BUILDER:IMPORTS` / `// AGENT-BUILDER:
   ENTRIES` markers, idempotently (skips insertion if the exact line is
   already present) and atomically.
3. **`scopeMcp`** — for each of the proposal's `suggestedServers`, looks up
   the pack entry (`getPackEntry`, `src/mcp/pack.ts`), ensures an entry
   exists under `mcpServers.<packName>` in `mcp.json`, and appends the new
   agent's name to that server's `agents` allow-list — writing the whole
   config back atomically.

This report documents the fixes applied for the Task 5 review findings
(regression + hardening + missing test coverage), not a new task.

## Fixes applied

### Finding 1 — CRITICAL: `scopeMcp` mutated the shared `STARTER_PACK` constant

The old code copied a pack entry into `mcp.json` with `{ ...entry.server }`
— a **shallow** copy. For pack entries that ship a preset `agents` array
(`file-tools` → `['file_qa']`, `fetch` → `['web_fetch']`), the copy's
`agents` property was the *same array reference* as the one inside
`src/mcp/pack.ts`'s exported `STARTER_PACK`. The subsequent
`agents.push(p.name)` therefore mutated the shared module-level constant in
place — every later caller in the process (any agent, any test) would see
the extra name leak into `file-tools`'s or `fetch`'s preset agent list.

Fixed by deep-cloning the nested `agents` array when the server entry is
first created in `mcp.json`:

```ts
if (!servers[s.packName]) {
  servers[s.packName] = {
    ...entry.server,
    agents: [
      ...(Array.isArray(entry.server.agents)
        ? (entry.server.agents as string[])
        : []),
    ],
  };
}
```

`current.agents` reads/writes still work exactly as before — only the
initial copy is now array-independent from the pack entry.

### Finding 2 — IMPORTANT: unescaped `p.name` interpolation + no defense-in-depth

(a) `renderAgentFile` used `name: '${p.name}'` (raw interpolation) instead of
the plan's `JSON.stringify(p.name)`. Changed to
`name: ${JSON.stringify(p.name)}` — consistent with how `description`,
`systemPrompt`, and `modelReq.role` are already emitted.

(b) Added a defense-in-depth guard at the top of `writeAgent` (before any
file is touched) that re-checks `p.name` locally, independent of
`validate.ts`:

```ts
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
...
export function writeAgent(p: AgentProposal, paths: WritePaths): string[] {
  if (!NAME_PATTERN.test(p.name)) {
    throw new Error(
      `writeAgent: invalid agent name ${JSON.stringify(p.name)} — must match ${NAME_PATTERN}`,
    );
  }
  ...
```

This decouples `write.ts` from upstream validation — `p.name` also drives
the import specifier, the registry key, and (via `${p.name}.ts`) the
on-disk file path, so an unvalidated name reaching this function is a
path-traversal / syntax-corruption risk regardless of what called it.
`write.ts` does **not** import `validate.ts` (kept as a local regex, per
the finding).

### Finding 3 — IMPORTANT: untested risk behaviors

Added three tests to `tests/agent-builder/write.test.ts`:
- idempotent re-insertion (`writeAgent` called twice → import line and
  entry line each appear exactly once in `agents/index.ts`).
- missing markers throw (seeded `index.ts` without the
  `AGENT-BUILDER:IMPORTS`/`:ENTRIES` markers → `writeAgent` throws, and the
  file is left byte-identical, i.e. it never silently corrupts `index.ts`).
- **regression test for Finding 1** — imports `getPackEntry` from
  `../../src/mcp/pack.ts`, snapshots `getPackEntry('file-tools')?.server
  .agents` via `structuredClone`, runs `writeAgent` with a proposal whose
  `suggestedServers` includes `{ packName: 'file-tools', scopeToAgent:
  'pack_regression_agent' }` into a temp workspace, then asserts the
  snapshot is unchanged afterward.

Also added a small test for the Finding-2 guard (rejects a
`../evil`-style name with a thrown error), and updated the existing
"writes a parseable agent file" test's assertion from `"name: 'pdf_qa'"`
(single-quoted, matching the old raw interpolation) to `'name: "pdf_qa"'`
(double-quoted, matching the new `JSON.stringify` output) — this is the
direct, expected consequence of the Finding-2(a) fix, not an unrelated
behavior change.

### Finding 4 — MINOR: dedupe factory-name expression

Extracted `factoryName(p: AgentProposal): string` (`` `create${pascalCase(p
.name)}Agent` ``) and pointed both `renderAgentFile` and `registerInIndex`
at it, removing the duplicated inline expression.

## TDD: RED → GREEN (Finding 1 regression test)

**RED** — regression test added first, run against the pre-fix
shallow-copy `scopeMcp` (before any of the fixes above were applied):

```
$ bun test tests/agent-builder/write.test.ts
...
tests/agent-builder/write.test.ts:
103 |       suggestedServers: [
104 |         { packName: 'file-tools', scopeToAgent: 'pack_regression_agent' },
105 |       ],
106 |     };
107 |     writeAgent(packRegressionProposal, paths);
108 |     expect(getPackEntry('file-tools')?.server.agents).toEqual(before);
                                                            ^
error: expect(received).toEqual(expected)

@@ -2,3 +2,3 @@
    "file_qa",
+   "pack_regression_agent",
  ]

- Expected  - 0
+ Received  + 1

      at <anonymous> (/Users/inderjotsingh/ai/tests/agent-builder/write.test.ts:108:55)
(fail) writeAgent > does not mutate the shared STARTER_PACK entry when scoping a preset-agents pack (regression) [1.30ms]

 5 pass
 1 fail
 14 expect() calls
Ran 6 tests across 1 file. [25.00ms]
```

This reproduces the finding exactly: `writeAgent` on an unrelated
`file-tools`-scoped proposal permanently added `pack_regression_agent` to
the live `STARTER_PACK` entry's `agents` array.

**GREEN** — after applying the `scopeMcp` deep-clone fix (Finding 1) plus
the remaining fixes (Findings 2 and 4) and the rest of the new tests
(Finding 3):

```
$ bun test tests/agent-builder/write.test.ts
bun test v1.3.11 (af24e281)

 9 pass
 0 fail
 19 expect() calls
Ran 9 tests across 1 file. [22.00ms]
```

All 9 cases pass: the 4 pre-existing tests (`pascalCase`, parseable file,
index insertion, mcp.json scoping, re-scoping without clobbering — now 6
counting the name-rejection and duplication additions folded in) plus the
5 new/changed tests from this review (name rejection, idempotent
re-insertion, missing-markers throw, and the Finding-1 regression test),
with the quote-style assertion updated to match `JSON.stringify` output.

## Gate results

- `bun test tests/agent-builder/write.test.ts` → `9 pass, 0 fail, 19
  expect() calls`.
- `bun run typecheck` (`tsc --noEmit`) → clean, no output.
- `bun run lint:file -- "src/agent-builder/write.ts"
  "tests/agent-builder/write.test.ts"` → clean:
  `Checked 2 files in 4ms. No fixes applied.`
- Full suite: `bun test` → `453 pass, 2 skip, 0 fail, 972 expect() calls,
  Ran 455 tests across 134 files. [194.28s]`. The 2 skips are the
  `describe.skipIf(!ready)` Ollama-gated live tests (expected — no local
  Ollama server reachable in this environment); no other file was affected
  by this change.
- `bun run docs:check` → passed: `✔ docs-check: living docs present +
  linked; every src subsystem documented.` No `docs/architecture.md`
  change was required — this fixes a bug and hardens/tests an already
  documented mechanism (`writeAgent`'s file/index/mcp.json writes); it does
  not add a new subsystem or change the documented shape of the write
  pipeline.

## Scope notes

- The fixed `.tmp`-suffix atomicity in `atomicWrite` was left as-is per the
  review's explicit instruction (acceptable for the single sequential
  caller in this pipeline; not in scope for this fix).
- No new dependencies were added; both fixes are local (regex guard,
  array spread) with zero new imports.
- Note: this same filename previously held a stale Slice-16 report (crew
  CLI migration to `withMcpRun`) — it has been overwritten with this Task 5
  / Slice 17 report.
