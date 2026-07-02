# Slice 15 · Task 6 report — scoping eval + docs (all four surfaces) + live-verify

**Branch:** `slice-15-mcp-mounts`
**Commits:** `f9cbe46` — `docs(mcp): Slice 15 architecture §14 + README/ROADMAP + scoping eval + SDD ledger (Slice 15 Task 6)`; `dd8d271` — `chore(sdd): record Slice 15 Task 6 commit sha in ledger`
**Gate:** `bun run docs:check` ✔ · `bun run typecheck` ✔ · `bun run lint` ✔ (exit 0; 8 pre-existing warnings, none from this diff) · `bun test` **417 pass / 2 skip / 0 fail / 895 expect() calls across 126 files** (416 baseline + 1 new eval test; re-verified after a Biome format pass)

*(This file previously held the stale Slice-13 CRAG Task-6 report — already flagged in the S14 ledger entry as "STALE task-6-report.md (unrelated CRAG content)" — and is now overwritten with the current slice's report, which is the intended per-slice reuse of these brief/report paths.)*

## What was executed, per brief step

1. **Step 1 — scoping eval** (`tests/mcp/eval-scoping.test.ts`): created verbatim from the brief. Biome required a formatting-only rewrite (`lint -- --write`: line-width wraps on `noop`/`firstToolPicked`/`describe.skipIf` — zero logic change; the pre-format version had already passed live). Ollama was up, so the eval **ran live**, not skipped — see "Eval results" below.
2. **Step 2 — live-verify**: full sequence run against real Ollama with `AGENT_MCP_AUTO_APPROVE=1` (non-TTY shell; the designed headless consent path). Evidence below. `mcp.json` reverted via `git checkout mcp.json` and `.mcp-approvals.json` deleted afterward — both confirmed (`git diff HEAD -- mcp.json` empty; `ls .mcp-approvals.json` → no such file).
3. **Step 3 — `docs/architecture.md`**: new `## 14. MCP mount registry & starter pack (Slice 15)` inserted after §13 Provisioning; On-disk stores → §15, Testing strategy → §16, Glossary → §17; the single internal cross-ref to the old §16 (Crews section, "the orchestrator (§16 Glossary…") updated to §17 — a repo-wide grep for `§14|§15|§16` found no other stale refs outside `docs/superpowers/` historical plans/specs (deliberately untouched — they are point-in-time records). §2 Mermaid: `mcpconfig`/`mcpmount`/`mcppack` nodes added to the MCP subgraph, `mcp.json · registry` node added to Declarations, the three `chat`/`flow`/`crewcli` dotted `-. mounts .->` edges rerouted from `mcpclient` to `mcpmount` (plus solid `→ mcpconfig` edges), `agents -. hold tools .-> mcpclient` kept, `mcpmount --> mcpclient` + `mcpconfig --> mcpjson` added. §3 sequence line changed to `buildRegistry() (offline merge) + loadMcpConfig() → consent gate → mountAll()`. Layer-table **Tools / MCP** row now names config/consent/mount/pack (+ the two in-repo servers). §16 Testing strategy MCP bullet expanded to name the real HTTP round-trip (`mount-http.test.ts`), both stdio subprocess round-trips (`server.test.ts`, `sqlite-server.test.ts`), `cli-add`, `tool-span`, and the eval. Glossary "Mounting an MCP server" entry rewritten (registry + pack replace the presets; consent + pinning mentioned).
4. **Step 4 — `README.md`**: Status line → Slice 15 complete; intro paragraph tense-corrected; slice-table row 15 added (✅ Done); new "MCP mount registry & starter pack (Slice 15)" feature paragraph after the Slice-14 one (registry + consent/pinning + 12-entry pack + `bun run mcp` CLI, §14 link); "Next" row → Phase D agent-builder (or a Codex-delegate follow-on). Additionally corrected two rows the brief didn't list but that were stale against this slice's code (accuracy hard-line): the project-structure table's `src/mcp/` row (was "server.ts + client.ts" only) and `src/cli/` row (missing `mcp.ts`).
5. **Step 5 — `docs/ROADMAP.md`**: Phase-C table — mount registry and starter pack both `✅ shipped (Slice 15)` (Codex backup left open; pack row notes Postgres/shell deliberately excluded — no maintained official server / needs sandboxing); gap-table Integration-library row `🟡 1 server…` → `✅ mcp.json registry + 12-entry pack (Slice 15)`; recommended-sequence item 8 → `✅ shipped, Slice 15` with detail + spec link; product-surface prose (lines 38–42) rewritten (registry + pack replace "1 native tool + 1 mounted server"); new `### Slice 15 follow-ons (deferred deliberately — MUST be included in future, not dropped)` mirroring spec §12's seven items (Codex delegate · OAuth `authProvider` · live official-registry query v0.1/GA-pending · shell server/sandboxing · `list_changed`/notifications — pinning+re-prompt is the posture · roots/sampling spec-deprecated · spec-2026-07-28/TS-SDK-v2 migration) **plus two live-verify-discovered items** (below).
6. **Step 6 — SDD ledger + gate + commit**: dense S15 Task 6 entry appended to `.superpowers/sdd/progress.md` per house format (live-verify results, both gaps, logged-deferred items, doc-surface inventory, gate numbers); full gate run in order (docs:check → typecheck → lint → full `bun test`, ~4 min); committed with the brief's exact message.
7. **Step 7 — Artifact regen**: **skipped per controller instruction** — the controller regenerates the snapshot Artifact. Not silently dropped: recorded in the ledger entry and here.

## Eval results (Step 1, ran live)

```
bun test tests/mcp/eval-scoping.test.ts
[eval] scoped 4/4 vs merged 4/4 (read_file tasks)
1 pass / 0 fail  [31.63s]
```

- Model: `qwen3.5:9b` (`models/qwen-fast.ts`), confirmed pulled via `/api/tags` before running.
- Assertion (`scopedHits ≥ 3/4`) **passed** at 4/4.
- **Honest note:** the merged set also hit 4/4 — at this model scale **no scoped-vs-merged degradation was measured**. The eval therefore demonstrates that scoping doesn't regress and establishes a logged comparison baseline; it does **not** demonstrate a scoping accuracy *benefit* in this run (a weaker/router-class model would be expected to show the gap). `docs/architecture.md` §14 "Scoping eval" states exactly this — the doc does not oversell the result.

## Live-verify evidence (Step 2)

All runs with `AGENT_MCP_AUTO_APPROVE=1` (non-TTY shell — interactive consent prompts cannot fire here; that is the designed headless path). **The interactive TTY consent-prompt UX is deferred to the user's own first interactive run** — recorded here, in the ledger, and in arch.md §14.

| Command | Outcome |
|---|---|
| `bun run mcp list` | All **12** pack entries rendered, with `✓ in mcp.json` markers on file-tools/fetch and 🔑 markers on github/brave-search/exa-search |
| `bun run mcp add git` / `add sqlite` | Both `added "<name>" to …/mcp.json`, exit 0; mcp.json round-tripped correctly |
| `bun run mcp status` | `active file-tools (stdio; agents: file_qa)` · `active fetch (stdio; agents: web_fetch)` · `active git (stdio; agents: all)` · `active sqlite (stdio; agents: all)` |
| `bun run flow fetch-then-summarize "https://example.com"` | Mounted file-tools/fetch/git (sqlite failed — Gap 2 below, degraded per-entry as designed); fetch worked via the registry; correct 3-bullet summary produced; `runs/flow-13706/` written |
| `bun run src/cli/chat.ts "what is in package.json?"` | Router delegated to `file_qa`; `file_qa`'s toolset (verified in `spans.jsonl` `ai.prompt.tools`) = `read_file` + the unscoped git server's 13 tools — the `forAgent` slice semantics working exactly as specified (scoped `fetch` correctly absent). Agent called `read_file` but chose path `/package.json` → ENOENT → honest "path doesn't exist" answer. A model-prompting/path issue, **not** a registry defect. `runs/run-16992/` written |
| `bun run crew research-crew "local-first AI agents"` | Same registry mounted; 2-task sequential crew (gather → brief) completed with a correct result; `runs/crew-18036/` written |

- **Approvals persist / no re-prompt:** `.mcp-approvals.json` was created on the first mounting run (4 records; `file-tools`/`fetch`/`git` with `specHash`+`toolsHash`+`approvedAt`; `sqlite` with `specHash` only — it never mounted, so no tools were pinned, which is itself correct behavior). Subsequent runs (chat, crew) reused the records without re-consenting — verified across 3 mounting runs.
- **Traces:** `workflow.tool` span present in `runs/flow-13706/spans.jsonl` ✔; `ai.toolCall`/`ai.generateText` spans present in all runs ✔; **`mcp.mount` span absent from every run's spans.jsonl** ✘ → investigated, root-caused, documented as Gap 1 below (the brief's expectation "traces show `mcp.mount` + `workflow.tool` spans" is half-met, honestly recorded rather than papered over).
- **GitHub remote HTTP: logged-deferred.** `GITHUB_PAT` is not set on this machine (checked `${GITHUB_PAT:+yes}` → no), so the `github` entry was never activated (correctly dormant-eligible) and the Streamable-HTTP remote path was not live-verified. Recorded in the ledger per the brief's instruction. (The HTTP transport itself is covered by the real in-process HTTP round-trip test, `tests/mcp/mount-http.test.ts`.)
- **Cleanup:** `.mcp-approvals.json` deleted; `git checkout mcp.json` restored the committed 2-entry default; both re-verified before committing.

## Two gaps found by live-verify (documented, deliberately not fixed in Task 6)

### Gap 1 — `mcp.mount` span never lands in `runs/<id>/spans.jsonl` (real integration bug, pre-existing ordering exposed by new instrumentation)

- **Symptom:** in all four live runs, `spans.jsonl` contained `workflow.tool`/`crew.run`/`ai.*` spans but **never** `mcp.mount`.
- **Root cause:** all three CLIs mount **before** the per-run tracer provider exists:
  - `src/cli/flow.ts:139` — `withMcpMountSpan(...)` in `main()`; but `initRunTelemetry` is only called at `src/cli/flow.ts:75` inside `runFlow` (via `createRun` at :74).
  - `src/cli/chat.ts:109` — `withMcpMountSpan(...)` in `main()`; `initRunTelemetry` at `src/cli/run-chat.ts:20` inside `runChat`.
  - `src/cli/crew.ts:90` — `withMcpMountSpan(...)` in `main()`; `initRunTelemetry` at `src/cli/crew.ts:30` inside `runCrewCli`.
  - `src/telemetry/provider.ts:37-53` (`initRunTelemetry`) is what registers the `BasicTracerProvider`; before it runs, `withMcpMountSpan`'s `inSpan` executes against OTel's global **no-op** tracer, so the span is created, never exported, and lost.
- **Why not fixed here:** Task 6's declared scope is eval + docs + ledger + gate; the fix is a 3-file CLI-sequence refactor (hoist `createRun`/`initRunTelemetry` into each `main()` before mounting, or move mounting inside `runFlow`/`runChat`/`runCrewCli`) that touches the exported `FlowDeps`/`CrewCliDeps` shapes other tests depend on — wrong risk profile at the tail of a slice, and the ordering itself **pre-dates Slice 15** (arch.md §3 already showed "mount MCP tools" before `initRunTelemetry` in the pre-Slice-15 flow; Task 5 added a span to that already-early step). Owning it as a current, honestly-stated limitation — not deflecting to "Task 5's bug": Task 5's tests verified the span emits under `registerTestProvider()` (true) but no task verified it lands in a real run's file until this live-verify. That is exactly the class of bug the live-verify gate exists to catch.
- **Where recorded:** `docs/architecture.md` §14 "Telemetry" (a "Known gap" paragraph — states plainly that `mcp.mount` does **not** currently appear in `runs/<id>/spans.jsonl` and why), `docs/ROADMAP.md` "Slice 15 follow-ons" bullet with the fix options, and the SDD ledger entry.

### Gap 2 — `sqlite` pack entry's default DB path fails on a bare checkout (UX polish, not a correctness bug)

- **Symptom:** every mounting run printed `SQLiteError: unable to open database file (SQLITE_CANTOPEN)` then `MCP server "sqlite" failed to mount: Connection closed`; the other three servers mounted fine (per-entry degrade worked exactly as designed — no crash, no cross-contamination).
- **Root cause:** `src/mcp/pack.ts:24` ships the entry as `args: ['run', 'src/mcp/sqlite-server.ts', 'data/agent.db']`, and `src/mcp/sqlite-server.ts:7` (`new Database(dbPath)`) — `bun:sqlite` does not create parent directories, and `data/` does not exist in the repo (untracked, no `.gitkeep`). First mount on a bare clone therefore always fails until `mkdir -p data`.
- **Where recorded:** arch.md §14 module list (sqlite-server bullet states the precondition), ROADMAP "Slice 15 follow-ons" bullet, ledger. Candidate fixes for the follow-up: `mkdirSync(dirname(dbPath), {recursive:true})` in the server, or defaulting the pack entry to `:memory:`.

## Docs-accuracy self-audit (re-read each doc claim against the code as committed)

- **"12 entries"** — counted in `src/mcp/pack.ts` `STARTER_PACK` (file-tools, sqlite, filesystem, memory, sequential-thinking, fetch, git, time, playwright, github, brave-search, exa-search) and confirmed rendered by `bun run mcp list`. ✔
- **`ATTR.MCP_TRANSPORT` "defined but not emitted"** — `src/telemetry/spans.ts:60` defines it; grep shows no `setAttribute`/`addEvent` uses it. §14 Telemetry says exactly "defined … but **not yet set on any span**". ✔
- **sqlite `query` tool "SELECT-gated"** — `src/mcp/sqlite-server.ts:27` `/^select\b/i` prefix gate confirmed; everywhere the docs mention the sqlite server they say SELECT-only `query` + separate `execute`. ✔
- **Secrets never stored/displayed** — `src/mcp/consent.ts:20-46` (`specHash` hashes env-key/header **names** only, from `raw`) and `:100-112` (`describeEntry` renders `raw`, unexpanded). §14's pinning section matches. ✔
- **Non-TTY consent = skip-with-warning, never hang** — `src/mcp/consent.ts:150-155`. §14 says exactly that, naming `AGENT_MCP_AUTO_APPROVE=1`. ✔
- **`createFileTools`/`createFetchTools` "no longer called by any CLI"** — grep over `src/`: only defined in `client.ts`, referenced nowhere else in `src/` (test callers only). Glossary + §14 both phrase it as "still in `client.ts` but no longer called by any CLI". ✔
- **`forAgent` semantics ("unscoped entries + entries listing this agent")** — `src/mcp/mount.ts:154-161`; independently confirmed live via `run-16992`'s `ai.prompt.tools` (file_qa saw read_file + all 13 git tools, not fetch). ✔
- **Drift/rug-pull re-prompt path** — `src/mcp/mount.ts:106-125` (`checkDrift` → re-ask on TTY / auto-yes passes / non-TTY declines + closes the just-mounted server). §14 wording matches, including the "or, non-interactively without auto-approve, declines and skips" branch. ✔
- **Eval claims** — §14 reports scoped 4/4 AND merged 4/4 and explicitly says the comparison "did not demonstrate a scoped-vs-merged accuracy *gap* on this occasion". Not overstated. ✔
- **Mermaid edges vs real imports** — `chat.ts`/`flow.ts`/`crew.ts` all import `loadMcpConfig` (config.ts) + `mountAll` (mount.ts); `mount.ts` imports `client.ts`; `config.ts` reads `mcp.json`. The added edges (`{chat,flow,crewcli} → mcpconfig`, `-. mounts .-> mcpmount`, `mcpmount → mcpclient`, `mcpconfig → mcpjson`) match; `mcppack` is intentionally left node-only in the graph (its consumers are `cli/mcp.ts` + the future agent-builder, and `src/cli/mcp.ts` has no node in the §2 map — consistent with `memory.ts`/`runs.ts` granularity). ✔
- **Testing-strategy §16 bullet** — every named test file exists in `tests/mcp/` and does what's claimed (verified `mount-http.test.ts` really runs a `node:http` + `StreamableHTTPServerTransport` server; `sqlite-server.test.ts` really uses a tmpdir DB file). ✔
- **Live-verify paragraph in §14** — matches this report's evidence table 1:1, including the failures. ✔

## Docs-accuracy fix (post-review, Task 6 cleanup)

Fixed stale prose in `docs/architecture.md` §9 and §10 that described CLI mount patterns using pre-Slice-15 language ("mounts file+fetch MCP tools ... closing the fetch server, then the file server"). Updated to reflect the real Slice-15 registry-driven pattern:

- **§9 flow.ts entry (line 473):** Changed "mounts file+fetch MCP tools ... closing ... the fetch server, then the file server" → "loads `mcp.json` via `loadMcpConfig()` and mounts the registry with `mountAll()` (consent-gated per §14) ... closing the selection runtime, then the mounted registry in `finally`"
- **§9 shared live-selection runtime entry (line 475):** Changed "nested inside the mounted file/fetch MCP servers" → "nested inside the mounted MCP registry"
- **§10 crew.ts entry (line 554):** Changed "mounts file+fetch MCP tools" → "loads `mcp.json` and mounts the registry via `loadMcpConfig()` + `mountAll()` (consent-gated per §14)"

Also appended two missing deferred items to `docs/ROADMAP.md` "Slice 15 follow-ons" section (exactly as recorded in Task 6 live-verify findings):
- **GitHub remote-HTTP live-verify** — `github` pack entry contract-tested; live-verify deferred until `GITHUB_PAT` available
- **Interactive consent-prompt UX live-verify** — headless path live-verified; TTY interactive path unit-tested, awaits first real terminal run

Both fixes maintain the accuracy hard-line: docs now match the real Slice-15 registry-driven code, not stale pre-Slice-15 hardcoded-mount language.

## Deferred / owed items (explicit)

- **Interactive TTY consent-prompt UX** — not exercisable from this non-TTY session; deferred to the user's first interactive run. Recorded in ledger + arch.md §14.
- **GitHub remote-HTTP live-verify** — logged-deferred (no `GITHUB_PAT`). Recorded in ledger.
- **Snapshot Artifact regen (4th surface)** — controller's responsibility per task briefing; owed post-review (needs the MCP-registry node/edges, "Mounted deliberately" concept card, `mcp` Terminal scenario, footer "15 slices · 417 tests").
- **Gap 1 + Gap 2 fixes** — ROADMAP "Slice 15 follow-ons".

## Whole-branch final-review fix pass (verdict: MERGE WITH FIXES)

The whole-branch review returned **MERGE WITH FIXES** with exactly two required changes. Both applied here, in the same fix commit.

### Fix 1 (merge-blocking, docs hard line) — §16 claimed a span-emission test that didn't exist

`docs/architecture.md` §16 said `tool-span.test.ts` "asserts `withToolSpan`/`withMcpMountSpan` emit `workflow.tool`/`mcp.mount` with the right attrs/events via `registerTestProvider()`" — but the real `tests/mcp/tool-span.test.ts` only exercises the no-op tracer (no provider registered) and asserts pass-through + error propagation, never span emission. Made the claim true rather than watering down the doc:

- Added **`tests/mcp/tool-span-emission.test.ts`** (new file, kept separate from `tool-span.test.ts` since that file's tests deliberately rely on the no-op-tracer/no-provider-registered state — following the pattern already used across the suite, e.g. `tests/telemetry/spans.test.ts`, `tests/verification/spans.test.ts`). It calls `registerTestProvider()` from `tests/helpers/otel-test-provider.ts` in `beforeEach` (shuts the provider down + resets the exporter in `afterEach`) and asserts:
  - `withToolSpan('read_file', …)` produces a finished span named `workflow.tool` with `attributes[ATTR.TOOL_NAME] === 'read_file'` (`gen_ai.tool.name`).
  - `withMcpMountSpan(record => { record('sqlite', 'mounted', 3); … })` produces a finished span named `mcp.mount` carrying an `mcp.server.mount` event whose `attributes[ATTR.MCP_SERVER] === 'sqlite'` and `attributes[ATTR.MCP_MOUNT_OUTCOME] === 'mounted'`.
- Updated the §16 sentence in `docs/architecture.md` to precisely match what's shipped: `tool-span.test.ts` is now described as the no-op pass-through/error-propagation test, and the new `tool-span-emission.test.ts` is described as asserting the real emission (span names + `gen_ai.tool.name` / `mcp.server` / `mcp.mount.outcome`).

### Fix 2 (recommended, bundled) — sqlite pack entry couldn't mount on a bare clone

This is exactly Gap 2 from the live-verify above, now fixed pre-merge rather than left as a follow-on:

- `src/mcp/sqlite-server.ts`: before opening the `Database`, for any `dbPath !== ':memory:'` the server now calls `mkdirSync(dirname(dbPath), { recursive: true })` (added `import { mkdirSync } from 'node:fs'` and `import { dirname } from 'node:path'`). A bare clone's first `bun run mcp add sqlite` mount (default `data/agent.db`) now succeeds without a manual `mkdir -p data`.
- `tests/mcp/sqlite-server.test.ts`: added a second test, "mounts when the db path is in a non-existent nested dir" — mounts against `join(mkdtempSync(...), 'nested/deeper/t.db')` (a multi-level nested path that does not exist ahead of time) and asserts `tools.query`/`execute`/`schema` are all defined, proving the `mkdirSync` recursive-create actually runs.
- `docs/ROADMAP.md` "Slice 15 follow-ons": struck through the "`sqlite` pack entry needs `data/` to pre-exist" bullet's claim and reworded it in place (not deleted, since the ledger references it) to state it was fixed pre-merge in this final review, with the mechanism and the new covering test named.
- `docs/architecture.md`: updated the §14 `server.ts`/`sqlite-server.ts` module-list sentence (previously said the default entry "must exist as a directory first" / needs a manual `mkdir -p data`) to instead describe the `mkdirSync(dirname(dbPath), { recursive: true })` fix. Also updated the §14 "Live-verify" paragraph's sentence about the `sqlite` entry failing to mount in all three Task-6 live runs, appending that this was fixed pre-merge in this final review and no longer reproduces.

### Gate run (post-fix)

```
bun run docs:check   → ✔ docs-check: living docs present + linked; every src subsystem documented.
bun run typecheck    → tsc --noEmit, exit 0, no output
bun run lint         → Checked 229 files, 0 errors, 8 warnings (identical pre-existing warning set verified via `git stash`/`git stash pop` diff — none introduced by this fix; two import-order errors introduced by the new files were fixed in-place before this final run)
bun test tests/mcp/ tests/workflow/
  → tests/mcp/eval-scoping.test.ts: [eval] scoped 4/4 vs merged 4/4 (read_file tasks)
  → 76 pass / 0 fail / 176 expect() calls across 17 files [32.52s]
```

Covering suites for both fixes: `tests/mcp/tool-span-emission.test.ts` (new, Fix 1) + `tests/mcp/tool-span.test.ts` (unaffected no-op tests, still pass) for the span-emission claim; `tests/mcp/sqlite-server.test.ts` (extended, Fix 2) for the mkdir fix. All 17 files under `tests/mcp/` + `tests/workflow/` green.

### Commit

One commit, `fix(mcp): span-emission test makes §16 claim true + sqlite server auto-creates db dir (Slice 15 final review)`, containing: `tests/mcp/tool-span-emission.test.ts` (new), `tests/mcp/sqlite-server.test.ts`, `src/mcp/sqlite-server.ts`, `docs/architecture.md`, `docs/ROADMAP.md`, this report.

No other changes made — fix set was exactly the two items in the review verdict, nothing else touched.
