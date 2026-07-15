# Task 19 report — Docs (architecture / README / ROADMAP) — Slice 30b Phase 3

**Commit:** `26d70ab` on branch `slice-30b-phase3-runs` (base: `3ca50a8`, the
Task-18 landing).

**Scope respected:** only `docs/architecture.md`, `README.md`,
`docs/ROADMAP.md` touched (`git diff --cached --stat` confirmed before
commit). `.superpowers/sdd/progress.md` was **not** edited — read-only, per
the controller's explicit instruction (that's the controller's own ledger to
maintain).

**Gate:** `bun run docs:check` → `✔ docs-check: living docs present +
linked; every src subsystem documented.` (PASS, run standalone and again
inside the pre-commit hook). `bun run typecheck` → clean (docs-only diff,
sanity check). Root full suite re-run for the README's test-count claim:
**1273 pass / 36 skip / 1 fail (3043 expect() calls, 1310 tests, 314 files)**
— the 1 fail is consistent with the SDD ledger's own note of a documented
pre-existing `verification.live` grounding-judge flake (real-Ollama
nondeterminism; the ledger records the same flake reproducing on a rerun at
the server-group gate — 1274→1273 pass is that one flaky test toggling, not a
regression from this docs change). Web suite: **83 pass (83), 21 files** —
matches Task 18's expected total (82 after Task 17's fix + 1 from Task 18's
nav-command test).

## Every substantive claim added to `docs/architecture.md` (for the docs-accuracy reviewer)

**System-map table (§2) + top Mermaid (`graph TD`):**
- Server row: added the 3 new GET endpoints (`/api/runs`, `/api/runs/:id`,
  `/api/runs/:id/stream`), `confineToDir` on `:id` for **both** detail and
  stream, the new `runsRoot` `ServerDeps` field wired from `main.ts`, and
  `run/run-dto.ts` added to the "knows about" column.
- Run-store row: added `run-dto.ts` (`mapRunToDto`/`summarizeRunListItem`,
  mtime-cached, shared `runRootSummary` helper) and `artifacts.ts`
  (`readRunArtifacts`).
- Mermaid `RUN` subgraph: added `rundto` and `runartifacts` nodes + edges
  (`rundto --> runtrace`, `rundto --> runartifacts`, `runartifacts -->
  spansfile`). **Judgment call:** I did *not* add Server/Contracts/web nodes
  to this top module-map graph — Phases 1/1b/2 never added them either (the
  graph has zero Server/Contracts/web representation today), so adding only
  Phase 3's 3 routes would have created a worse, inconsistent partial picture
  than the established convention of documenting Slice-30b subsystems via
  prose sections + their own sequence diagrams. Flagging this in case the
  reviewer wants the top graph made comprehensive as a separate follow-up.

**New §3d sequence diagram** ("Runs history + live trace waterfall") — added
right after §3c, before §4: browser → `GET /api/runs` (list, cache-fronted) /
`GET /api/runs/:id` (detail, confineToDir) / `GET /api/runs/:id/stream`
(stream, poll+SSE) → `run/run-dto.ts` mapper → `runs/<id>/*.jsonl` disk, plus
the Last-Event-ID resume note.

**Contracts § edits:**
- `ArtifactKind` extension: named the 6 new members (`Result`/`Resource`/
  `Unverified`/`Failed`/`Error`/`Media`) alongside the 5 original.
- `RunListItemDTO` added to the DTO list, described as spans/artifacts/
  degrades-free.
- `RunListQuerySchema`/`RunListResponseSchema` added to the requests
  paragraph, with the coercion details (degraded string→bool, limit
  coerced/clamped/defaulted).
- Added a sentence that Phase 3's mapper still emits `origin` as the
  constant `RunOrigin.Manual` — the reservation is unchanged, only the DTO
  now has a real reader.
- Added the "three telemetry-gap closures" paragraph (token roll-up,
  lifecycle synthesis, artifact classification) with the CLI-vs-web
  divergence note (`run-trace.ts`'s `summarizeRun` only ever recognized
  `agent.run`).

**New `## Runs (web UI — Slice 30b Phase 3)` section** (end of file), with:
- Feature paragraph naming it the first real transport-port consumer and
  first RunDTO/SpanDTO emitter/parser.
- `### Server` subsection: exact route list, the ordering requirement
  (stream regex before bare-`:id`), the confineToDir/404-indistinguishable
  guarantee, poll/pollMs/maxWaitMs/Last-Event-ID-resume mechanics for the
  stream route, `RunsDeps = {runsRoot}`.
- `### The src/run mapper` subsection: `mapRunToDto` mechanics (flatten,
  project, sum tokens, degrade tolerance via safeParse), the
  `runRootSummary` shared-helper fix narrative (crew/workflow root bug,
  caught adversarially), `summarizeRunListItem` + the mtime-cache rationale
  (keyed on `spans.jsonl` mtime, not dir mtime — explicit "Phase 6 real
  index" note), `readRunArtifacts` classification + media roll-up + missing-dir
  tolerance.
- `### Web` subsection: `RunsArea` (search/facets/cursor pagination/empty/error
  states), `RunDetail` (snapshot+live-tail, the two-effect structure, the
  adversarially-caught-and-fixed missing-AbortController leak, the
  streamEnded busy-indicator fix), `use-run-trace.ts`'s `foldSpan` reducer,
  `Waterfall` (`@visx` Gantt mechanics, color precedence, D1 no-`@xyflow`
  note).
- `### Telemetry`: `withRunStreamSpan` mirrors `withUiStreamSpan`, the 5
  `RUN_STREAM_*` attrs (chunks/bytes/resumes/outcome/run_id), list/detail
  ride the existing `server.request` span (no dedicated span).
- `### What's still deferred`: SessionStore/persisted index → Phase 6,
  `@xyflow` (D1), reserved `SpanDTO.node`/`RunDTO.origin`/`server.principal`,
  retention GC (Tier-2 backlog), a11y/⌘K → Phase 8, voice → Phase 7.
- Two honest minor caveats called out explicitly (not hidden): resume
  reseeds via flattened DFS order not append order (an edge case on
  overlapping siblings); `RUN_STREAM_BYTES` counts UTF-16 units, not UTF-8
  bytes (telemetry approximation).
- Updated the stale Phase-2 "what's still deferred" bullet that pointed
  forward to "Phase 3 (Runs)" — now marked shipped with a pointer to the
  new section, since it would otherwise read as still-open even though the
  code landed.

## README.md changes
- Top overview blockquote: replaced the forward-looking "Next: Slice 30b
  Phase 3" line with a landed-Phase-3 paragraph + "Next: Slice 30b Phase 4".
- Status blockquote: extended the phases-landed list to include Phase 3,
  changed "Phases 3–8 remain" → "Phases 4–8 remain", trimmed the stale
  "not yet shipped" bullet (Runs was in that list), inserted a full new
  Phase-3 paragraph mirroring the existing Phase-2 paragraph's depth, with
  the corrected/rerun test counts and the flake footnote.
- Slice-status table: extended the `30b` row's phase list and prose to
  cover Phase 3 (routes, mapper, web), changed the Status cell to "Phases 1,
  1b, 2 & 3 landed"; **slice-30b capability marker intentionally left as
  🚧 In progress** (not flipped to ✅) per the partial-slice instruction.
- "Next (product line)" row: now points at "Slice 30b Phase 4 onward"
  instead of "Phase 3 onward", dropped the now-shipped Runs bullet from the
  description.

## docs/ROADMAP.md changes
- Phase F table row ("TUI / local web UI"): extended the phases-landed
  clause to include Phase 3, changed "the run-history browser (Phase 3) …
  not yet functional" to "now works too", added a Phase-3 mechanism summary
  sentence, added a `§"Runs"` architecture.md pointer.
- Recommended-sequence bullet list (item 21, Slice 30b): replaced the single
  "Phases 3–8 — … not yet started" placeholder with a full shipped Phase-3
  sub-bullet (mirroring the existing Phase 1/1b/2 sub-bullet depth and
  style) plus a trimmed "Phases 4–8 — … not yet started" successor bullet.
- **Judgment call on brief wording:** the brief said "gap table + phase
  table + recommended sequence." I interpreted "phase table" as the Phase F
  items table (only place Slice 30b's phases are itemized) and did not touch
  the separate n8n/CrewAI-concept "honest gap" table near the top of the
  file (lines ~94–111) — it has no web-UI-specific row today and adding one
  there would be a new addition, not a flip, and isn't mentioned as a target
  by the SDD ledger. Flagging in case the reviewer expected that table
  touched too.

## Where I was unsure of the truth (self-flagged, not hidden)
- The exact current root full-suite pass/fail count is a live, slightly
  moving target because of the pre-existing flaky live-verification test;
  I ran it live and reported the observed 1273/36/1 with the flake caveat
  rather than copying the ledger's 1274/36/0, on the theory that a number I
  personally re-ran is more trustworthy than transcribing an older number —
  but if a fresh run shows a clean 0-fail count, that's the more
  representative one to cite going forward.
- I did not independently re-verify the Task-17 "adversarial review caught a
  missing AbortController" narrative against the actual diff between
  commits `3141f2b` (initial) and `91d61c8` (fix) — I took the ledger's
  account of that fix at face value since it matches what I read in the
  *current* `run-detail.tsx` (which does have the AbortController + abort()
  cleanup + AbortError swallow), so the current-state description is
  verified even if the historical "before" state is ledger-sourced.
- Note: this file previously held a stale Slice-26 documentation-sweep
  report (a much earlier "Task 19" from a different slice's numbering) —
  it has been fully overwritten with this Phase-3 report; nothing from the
  old content was preserved or merged.
