# Task 30 report — Docs, all four surfaces (Slice 30b Phase 5 closeout)

## Scope

Whole Phase-5 milestone (Increments 1–6, tasks T1–T29), not just the MCP/Memory
increments. Source of truth: `.superpowers/sdd/progress.md`'s "SLICE 30b —
PHASE 5" section (read in full before writing), plus a live read of the actual
shipped code (`src/server/{builders,models,mcp,memory}/`,
`web/src/features/{builders,library}/`, `src/contracts/enums.ts`) to ground
every claim in what the diff actually does, not just what the brief said it
would do.

## What was updated per surface

### `docs/architecture.md`

- **New §3f** sequence diagram, "Builders + Library — web flows (browser
  SSE/REST, Slice 30b Phase 5)" — inserted after §3e, before "## 4. Resource
  model". Covers all four flows: builder SSE build+consent, model pull→spans
  bridge, MCP list/add/test-mount, memory spaces/recall/ingest.
- **§7 Observability**: added a paragraph documenting `RunKind.Build`/`Pull`
  (additive root-span-name recognition) and the `model.pull.progress`
  per-tick child-span mechanism (why no new stream code was needed).
- **§11 Memory/RAG**: new "Web (Slice 30b Phase 5)" subsection — memory's
  first web consumer, `:space` allowlist, fork-3 confinement for ingest,
  clarifies `memory.recall`'s span was already wired pre-phase (corrects any
  stale "no web consumer" framing per the brief's instruction).
- **§13 Provisioning**: new "Web pull (Slice 30b Phase 5)" subsection —
  direct `provider.download` call vs. full `runProvision` orchestration,
  pre-resolved selection/consent, pull→spans bridge cross-reference.
- **§14 MCP**: module-map bullets added for `write.ts` (atomic config writer,
  the T19 dormant-`kind`-retention fix) and `mcp-dto.ts` (addressable
  mount-status snapshot); new "Web (Slice 30b Phase 5) — closes the D10
  consent gap" subsection documenting `test-mount`'s consent bridge, the
  wall-clock fail-closed timeout, and `src/mcp/mount.ts`'s zero diff.
- **§18 Agent-builder / §19 Crew-workflow-builder**: each gained a "Web
  builder (Slice 30b Phase 5)" note — the wizard as a third trigger
  alongside the CLI and the chat gap-offer, same validation/consent gate,
  no same-run-activation change.
- **§2 module map**: Contracts, Server, and Web-frontend rows extended with
  every Phase-5 addition (new server dirs, new contract enums/DTOs/schemas,
  `features/builders`/`features/library`).
- **New "Builders + Library (web UI — Slice 30b Phase 5)" section**
  (mirrors the Phase-4 "Crews & Workflows" section's structure: Contracts /
  Server / Web / Telemetry / What's still deferred), appended at end of
  file. Documents every route (`build.ts`, `list.ts`, `models/{list,pull}`,
  `mcp/{list,add,test-mount,mount-one}`, `memory/{spaces,recall,ingest}`),
  the two ultracode-verified mechanisms (builder SSE route, pull→spans
  bridge), the D10 closure, fork-3 confinement, and the honest deferred list
  (OAuth-callback route, media-gen management, MCP edit/remove, no ANN
  index, recall-not-in-chat, Library a11y).

### Root `README.md`

- "Where this is going" intro paragraph: removed the stale "builders/library
  screens... remain Phases 5–8" claim (now landed), added a Phase-5 summary
  sentence, moved "Next" to Phase 6.
- **Status blockquote**: Phases list extended to include "5 (Builders +
  Library)"; a full Phase-5 narrative paragraph inserted after the Phase-4
  paragraph (before "Previously: Slice 30a...") covering Builders/Models/
  MCP/Memory with the same density as the Phase-2/3/4 paragraphs, plus the
  verified test-count line.
- **Slice-status table**: the `30b` row's phase list extended with "+ 5
  (Builders + Library)"; a Phase-5 sentence appended to the cell (matching
  the existing Phase-2/3/4 append pattern); status marker → "Phases 1, 1b,
  2, 3, 4 & 5 landed".
- **"Next (product line)" row**: pointer moved from "Phase 5 onward" to
  "Phase 6 onward" (persistence + voice); builders/library language removed
  since it's now shipped.

### `docs/ROADMAP.md`

- **Gap table** ("TUI / local web UI" row): extended the in-progress prose
  to "... + 5 (Builders + Library: agent/crew/workflow build wizards,
  Models/Memory/MCP) landed; persistence/voice phases pending", changed
  "the builders/library screens are still not yet functional" →  "no longer
  ... not yet functional", and appended a full Phase-5 capability sentence
  to the existing Phase-1–4 narrative (same append pattern as prior phases).
- **Phase table** (recommended-sequence item 21, Slice 30b sub-bullets):
  added a new "Phase 5 — Builders + Library (Models · Memory · MCP)" bullet
  mirroring the Phase-4 bullet's density (per-route Server narrative, Web
  narrative, Deferred list, plan/spec/ledger references).
- **Two new backlog rows registered** (per spec §9, Step 3's instruction):
  **44** (stable `POST /api/mcp/oauth/callback` BFF route, fork-2 follow-on)
  and **45** (full media-gen model management web surface, parallel
  Slice-28 catalog) — both flagged "registered per register-then-plan; not
  designed until picked up," consistent with the existing Tier-2 backlog
  rows' convention.

### SDD ledger (`.superpowers/sdd/progress.md`)

Appended a `Task 30: complete` entry (not a new phase header — Phase 5's
header already exists from earlier in the phase) summarizing every doc
surface touched, the verified test counts, the gate results, and a pointer
to this report. Added an increment-boundary-style closing note pointing at
the next step (whole-branch review → T31 live-verify → land).

## Test counts used + how verified

Ran both suites live rather than trusting the brief's numbers blind:

- Root: `bun run test` → **1429 pass / 36 skip / 0 fail**, 3386 `expect()`
  calls, 1465 tests across 360 files, 278.69s. (Two pre-existing noisy-but-
  expected stderr lines from `tests/verification/deps.test.ts` and
  `tests/voice/capture-file.test.ts` — not failures, just console output the
  tests intentionally exercise.)
- Web: `cd web && bun run test` → **150 pass, 39 test files**, 8.98s.

Both match the controller-supplied numbers (root 1429/36, web 150/39)
exactly — used as-is in README/architecture.md.

## Gate results

- `bun run docs:check` → **PASS** ("living docs present + linked; every src
  subsystem documented").
- `bun run typecheck` → **PASS** (clean `tsc --noEmit`, no output).
- `bun run lint:file` — **N/A**: only `.md` files were changed this task (no
  source/test files touched), so there is nothing for Biome to lint.

## Files changed (this task's commit)

- `/Users/inderjotsingh/ai/docs/architecture.md`
- `/Users/inderjotsingh/ai/README.md`
- `/Users/inderjotsingh/ai/docs/ROADMAP.md`
- `/Users/inderjotsingh/ai/.superpowers/sdd/progress.md`

(Note: `git status` at task start showed a number of *other* already-modified
files — `.remember/*` and several `.superpowers/sdd/task-N-{brief,report}.md`
files — pre-existing from earlier work in this session/branch, not touched
by this task. Only the four files above are staged/committed for Task 30.)

## Concerns

- None blocking. The new architecture.md "Builders + Library" section is
  intentionally somewhat more concise (~200 lines) than the Phase-4 section
  (~320 lines) given the time/effort budget for a docs-only task — it is
  complete and accurate against the code and ledger, just not padded to
  exact line-count parity with Phase 4.
- The docs-accuracy audit in the upcoming whole-branch review should still
  spot-check the new architecture.md section against the diff, per the
  project's standing "presence is enforced by tooling; truth is the
  review's job" rule.

---

## Final-review fix wave (Fixer 1) — ROOT + DOCS

**CRITICAL #1 — ghost "running" runs (correctness).** Confirmed the three
ephemeral-run ROOT span names by reading the producers: `mcp.mount`
(`src/telemetry/spans.ts:793`, opened via `withMcpMountSpan` from
`mount-one.ts`), `memory.recall` (`spans.ts:584`, `withMemoryRecallSpan` in
`retrieve.ts`), `memory.ingest` (`spans.ts:629`, `withMemoryIngestSpan` in
`store.ts`). Added all three to `RUN_ROOT_NAMES` in `src/run/run-dto.ts` so a
finished recall/ingest/test-mount now resolves to a terminal lifecycle
(Done/Failed) with a real duration instead of perpetual Running / durationMs 0.

**deriveRunKind decision:** took the preferred path — added `RunKind.Mcp='mcp'`
+ `RunKind.Memory='memory'` to `src/contracts/enums.ts` (contract-owned, no
engine mirror → no parity test, exactly like Build/Pull). Mapped
`mcp.mount`→Mcp, `memory.recall`/`memory.ingest`→Memory. Chose distinct
kinds (not one shared) because they are genuinely different operations and it
matches the Build/Pull precedent; recall+ingest share Memory since they are two
faces of the same subsystem. No ROOT code exhaustively switches on RunKind
(only `z.enum(RunKind)` in dto.ts/requests.ts) — typecheck clean.

**Regression test (Fable's repro):** `tests/run/run-dto.test.ts` — a completed
`memory.recall` run → lifecycle **Done** (explicitly `.not.toBe(Running)`),
durationMs 17, kind Memory; plus companion tests for completed `memory.ingest`
(Done/Memory) and `mcp.mount` (Done/Mcp). Extended `tests/run/run-kind.test.ts`
(deriveRunKind for the 3 new roots) and `tests/contracts/run-kind-build-pull.test.ts`
(full RunKind member set now 8). **Fixed collateral:** `tests/run/error-lifecycle.test.ts`
used `mcp.mount` as a stand-in for a non-root orphan span (encoding the very bug)
— switched those 5 cases to `agent.delegation` so they still exercise the
early-failed error.json rescue.

**DOCS-IMPORTANT — wrong endpoint.** `GET /api/builders` does not exist.
Corrected to the two real wired routes `GET /api/builders/agents`
(`handleBuilderAgentList`) + `GET /api/builders/crews` (`handleBuilderCrewList`),
both in `src/server/builders/list.ts`, wired in `app.ts` — verified by reading
list.ts + grepping app.ts. Fixed in `docs/architecture.md` (§Builders route
list ~4404) and `docs/ROADMAP.md` (Phase-5 detail). MINOR: added the
`data-run-start {runId}` first-frame to both SSE flows in the §3f sequence
diagram (builder + test-mount).

**Root minors:** #6 — `test-mount.ts` RunEnd now carries the actual result
outcome (`mounted`/`skipped`/`dormant`) via a hoisted `runOutcome`, mirroring
the builder route's `outcome: result.kind`; asserted in 3 mcp-test-mount tests
via a new `runEndOutcome()` helper. #7 — corrected the `mcp-dto.ts` comment
(Test-Mount on a dormant row IS enabled; server emits the dormant terminal).
#9 — deleted the orphan `MemorySpaceListResponseSchema` + `RetrievalResponseSchema`
(+ their now-unused DtoSchema imports) and fixed the doc-comment that referenced
them; the shipped wire is bare arrays per spec §4.2.

**Gate:** `bun run typecheck` clean · `bun run docs:check` PASS · `bun run
lint:file` (10 files) 0 errors · `bun test tests/run/ tests/contracts/
tests/server/mcp-test-mount.test.ts` → 139 pass / 0 fail; `bun test tests/server/`
→ 163 pass / 0 fail. Files: `src/run/run-dto.ts`, `src/contracts/enums.ts`,
`src/contracts/requests.ts`, `src/server/mcp/test-mount.ts`, `src/mcp/mcp-dto.ts`
+ tests + `docs/architecture.md`, `docs/ROADMAP.md`. No `web/**` touched.
