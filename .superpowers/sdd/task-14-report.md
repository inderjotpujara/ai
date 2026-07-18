# Task 14 Report: web guided-flow wizard + proposal `DagView` (agent-only)

**Status:** DONE
**Commit:** `0d9b026` — feat(web): guided-build wizard (Agent/Crew) + D6 post-write proposal DagView (Phase 5)

## What was implemented

Increment 2's final, visible payoff: a guided-build wizard UI wired to T13's
`useBuildEvents`, replacing T8's echo-stub scaffold in the Builders area.

- **`web/src/features/builders/proposal-graph.ts`** — `agentProposalGraph(p: AgentProposalDTO): DagModel`,
  a pure projection of a committed `AgentProposalDTO` to D6's 2-tier `DagModel`:
  one `manager`-kind node for the agent, one `StepKind.Tool`-kind node per
  `suggestedServers` entry (id `${agent}::${packName}`), linked by `delegates`
  edges, all rendered `DagStatus.Done` (per the brief's design note D6: the
  proposal only reaches the browser on `BuildResultDTO.proposal`, which is
  populated post-commit for a `written` agent build, not pre-consent — so
  `Done`, not `Proposed`, is the honest status here).
- **`web/src/features/builders/builder-wizard.tsx`** — `BuilderWizard({ kind, title })`,
  the shared wizard body: need-textarea → `Build` button → streamed narration
  list → `ConfirmPrompt` on a pending `data-confirm` → terminal render (D6
  `DagView` for a written agent result with a `proposal`, else a raw
  `<pre>` JSON dump of the result for every other outcome/kind).
- **`web/src/features/builders/agent-wizard.tsx`** / **`crew-wizard.tsx`** — thin
  wrappers binding `BuilderKind.Agent`/`BuilderKind.Crew` + a title onto
  `BuilderWizard` (per D11: one reusable wizard body, not two near-duplicates).
- **`web/src/features/builders/index.tsx`** — `BuildersArea` now hosts an
  Agent/Crew mode toggle (`role="tablist"`/`role="tab"`, `data-testid`
  `builders-mode-agent`/`builders-mode-crew`) over `AgentWizard`/`CrewWizard`,
  replacing T8's echo-stub body entirely.
- **Deleted** `echo-stub.ts`, `echo-stub.test.ts`, and the old `index.test.tsx`
  (T8's scaffold, per its own note that Increment 2 replaces it wholesale).
- **`index.test.tsx`** recreated against the real wizard (renders
  `area-builders`, defaults to "Agent Builder").

## Deviation from the brief's test snippet (verified against real code)

The brief's Step-5 `builder-wizard.test.tsx` snippet modeled the terminal
build result as a `text-delta` (id `'build-result'`) carrying a
JSON-stringified `BuildResultDTO`, and modeled `data-run-start`/`data-confirm`/
`data-run-end` as flat (unenveloped) objects. Both are stale relative to the
ACTUAL T13 implementation (`use-build-events.ts`, `use-build-events.test.ts`'s
own integration test, and `src/server/builders/build.ts`), which:
- wraps `data-run-start`/`data-confirm`/`data-run-end` in an AI-SDK data-part
  envelope (`{ type, data: <StatusEvent>, transient: true }`), and
- writes the terminal `BuildResultDTO` as a one-shot **`data-build-result`
  DATA part** (`{ type: 'data-build-result', data: <DTO> }`), never a
  text-delta/JSON-string.

This was already called out in `use-build-events.ts`'s own doc comments as a
Task-11 adversarial-verification correction to the original Task-13 brief
snippet. I adjusted `builder-wizard.test.tsx`'s two SSE mocks to match the
real wire shape (envelope-wrapped status events + `data-build-result` data
part) rather than the brief's stale snippet — same resolution the codebase
already applied to `use-build-events.test.ts`. `agentProposalGraph`,
`BuilderWizard`, `agent-wizard.tsx`, `crew-wizard.tsx`, and `index.tsx` were
implemented verbatim from the brief.

One additional fix: `index.test.tsx`'s first assertion used
`screen.getByTestId` (sync) per the brief's literal snippet, but this repo's
routed tests are async-first (per the task's own execution note) — changed
to `await screen.findByTestId('area-builders')` to avoid a race with
`TanStack Router`'s async route resolution; this was confirmed necessary by
an initial RED run (`Unable to find an element by: [data-testid="area-builders"]`).

## TDD evidence

- **RED** (`proposal-graph.test.ts`): `Failed to resolve import "./proposal-graph.ts"` — confirmed before creating the module.
- **GREEN**: `cd web && bun run test -- proposal-graph.test.ts` → 2/2 passed.
- **RED** (`builder-wizard.test.tsx`): `Failed to resolve import "./builder-wizard.tsx"` — confirmed before creating the component.
- **GREEN**: `cd web && bun run test -- builder-wizard.test.tsx proposal-graph.test.ts` → 4/4 passed.
- **RED** (`index.test.tsx`, post-implementation first run): `Unable to find an element by: [data-testid="area-builders"]` — caught the sync-vs-async-first gap; fixed with `findByTestId`.
- **GREEN** (full builders group): `cd web && bun run test -- builders/` → 4 test files, 11/11 tests passed.

## Gate (WEB task — both root + web)

- `cd web && bun run typecheck` — clean.
- `cd web && bun run test` — 35 test files, 133 tests, all passed (an
  unrelated `ECONNREFUSED :3000` stack trace appears in stderr from a
  pre-existing test's fetch-failure path; it is a logged trace, not a test
  failure — exit code 0, all green).
- `bun run typecheck` (root) — clean (no root files touched by this task).
- `bun run lint:file -- <8 changed builders files>` (biome) — initially
  flagged import-order + formatting; fixed via `bunx biome check --write`
  on the same file set; re-run confirmed clean (`No fixes applied`).

## Files changed

- Created: `web/src/features/builders/proposal-graph.ts`, `proposal-graph.test.ts`, `builder-wizard.tsx`, `builder-wizard.test.tsx`, `agent-wizard.tsx`, `crew-wizard.tsx`
- Modified: `web/src/features/builders/index.tsx`, `index.test.tsx`
- Deleted: `web/src/features/builders/echo-stub.ts`, `echo-stub.test.ts`

## Self-review

- `agentProposalGraph` is pure/dependency-free (no React, no fetch) — matches
  `workflow-graph.ts`/`crew-graph.ts` sibling precedent for a `DagModel`
  producer.
- `BuilderWizard` consumes `useBuildEvents()` exactly as T13 exports it
  (`narration`, `pendingConfirm`, `result`, `start`, `respond`); `respond`
  is passed straight to `ConfirmPrompt`'s `onAnswer`, matching the existing
  chat-area consumption pattern (Task 15's `ConfirmPrompt`).
  `isWrittenWithProposal` is a narrow runtime type guard over the otherwise-
  `unknown` fold `result` — deliberately conservative (checks `kind ===
  'written'` + a present `proposal` key) so a crew/workflow `written` result
  (no `proposal`, per the D6 engine-side gap) correctly falls through to the
  plain JSON `<pre>` render instead of crashing on a missing graph.
  Agent-only scope honored: no crew/workflow IR→DagModel projector was built
  (`CrewWizard` intentionally has no graph path — matches the brief's design
  note verbatim).
- Mode toggle in `BuildersArea` follows the existing `role="tablist"`/
  `role="tab"`/`aria-selected` + `data-testid` idiom already used elsewhere
  in the app shell; Tailwind v4 token classes (`var(--color-*)`) match
  sibling feature components (crews/workflows/runs detail).
- Confirmed via `git diff --cached --stat` before commit that only the 10
  intended `web/src/features/builders/*` files were staged — no accidental
  inclusion of concurrently-modified `.superpowers/sdd/*` or `.remember/*`
  files from other in-flight tasks in this multi-task run.

## Concerns

- None blocking. The brief's own design note (D6) already flags the one
  real limitation carried forward: `DagStatus.Done` (not `Proposed`) because
  the browser only ever sees the proposal post-commit this phase; a genuine
  pre-consent staged preview is an explicitly deferred follow-on, not a gap
  in this task's scope.

## Follow-up fix (post-review): 2 Important findings

**Commit:** `4b73405` — fix(web): validate builder terminal result via
`BuildResultDtoSchema` + cover crew-toggle switch (Phase 5 T14 review)

**Finding 1 — terminal result never schema-validated.** The original
`isWrittenWithProposal` guard was a hand-rolled duck-type check (`kind ===
'written'` + truthy `proposal`) that did NOT validate against
`BuildResultDtoSchema`, even though the comments in `use-build-events.ts`
claimed Task 14 does. Since `BuildResultDTO.proposal` is an UNdiscriminated
union of Agent/Crew/Workflow proposal schemas, a crew/workflow `written`
result carrying a `.proposal` would have passed the old guard and been fed
into `agentProposalGraph` (which assumes agent-shaped `.name`/
`.suggestedServers`) — the exact defect the review predicted.

Fix, in `builder-wizard.tsx`:
- `BuildResultDtoSchema.safeParse(result)` validates the whole terminal
  payload before anything derives from it (matches the existing repo
  pattern in `use-status-events.ts`'s `StatusEventSchema.safeParse`). An
  invalid/unparseable result now renders nothing rather than a raw dump of
  an untrusted shape.
- `AgentProposalDtoSchema.safeParse(dto.proposal)` is the real agent
  discriminant gating the `DagView` render — a crew/workflow proposal fails
  this parse (no `suggestedServers`/`modelReq`) and correctly falls through
  to the generic `<pre>` result card, which now renders the validated `dto`
  instead of the raw `result`.
- Removed the `isWrittenWithProposal`/`WrittenResult` hand-rolled guard
  entirely.

**Finding 2 — mode-toggle switch had no test coverage.** The
"defaults to the Agent wizard and can switch to Crew/Workflow" test in
`index.test.tsx` only asserted the default Agent state; it never exercised
the toggle. Added, in the same test: `fireEvent.click(screen.getByTestId('builders-mode-crew'))`,
then `await screen.findByText('Crew / Workflow Builder')` and
`await screen.findByTestId('builder-wizard-crew')` assert the Crew/Workflow
wizard actually rendered, plus a negative assertion that "Agent Builder" is
no longer present — using this repo's async-first (`findBy*`) convention.

### Gate evidence (fix commit)

- Root: `bun run typecheck` — clean.
- Web: `cd web && bun run typecheck` — clean.
- Web: `cd web && bun run test` — **35 test files, 133 tests, all passed**
  (same benign `ECONNREFUSED :3000` stderr trace as the original task run,
  unrelated pre-existing fetch-failure path, exit 0). Re-ran scoped:
  `cd web && bun run test -- builders` → **4 test files, 11 tests, all
  passed** (covers `builder-wizard.test.tsx`, `index.test.tsx`,
  `proposal-graph.test.ts`, `use-build-events.test.ts`).
- Lint: `bun run lint:file -- web/src/features/builders/builder-wizard.tsx web/src/features/builders/index.test.tsx`
  (biome) — 1 formatting error caught on first run (test-file line wrap),
  fixed; re-run clean (`No fixes applied`).
- `git diff --cached --stat` confirmed only the 2 intended files were
  staged before commit.

### Files changed (fix)

- Modified: `web/src/features/builders/builder-wizard.tsx`,
  `web/src/features/builders/index.test.tsx`
