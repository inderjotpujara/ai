# Task 20 report — Slice 19 docs sweep

## Scope
Updated the 3 doc surfaces this task owns (architecture.md, README.md,
ROADMAP.md) + the SDD ledger. The interactive Artifact (4th surface) is
explicitly deferred to the controller per the task brief.

## Verification method
Read every file in `src/crew-builder/` (all 13: `ir.ts`, `safe-helpers.ts`,
`types.ts`, `classify.ts`, `analyze.ts`, `plan-nodes.ts`, `plan-edges.ts`,
`validate.ts`, `transpile.ts`, `resolve-members.ts`, `write.ts`, `builder.ts`,
`deps.ts`), plus `src/cli/crew-builder.ts`, `src/cli/offer-crew.ts`, the
`chat.ts` gap-branch wiring, `src/workflow/define.ts`'s `assertAcyclic`,
`src/crew/types.ts` + `engine.ts`'s `agentRef`/`crewAgentMap`, `src/telemetry/
spans.ts`'s `withCrewBuildSpan` + `CREW_BUILD_*` ATTR keys, `crews/index.ts` +
`workflows/index.ts` marker comments, `package.json`'s `crew-builder` script,
and the full Slice-19 SDD ledger (Tasks 1–19) — before writing any doc prose.
No claim below is paraphrased from the task brief without independent
verification against the code.

## 1. `docs/architecture.md`

- **§2 module-map row** (`Crew-builder`): the row already existed from Task 1
  (tagged `*(in progress, Slice 19)*`) and was largely accurate, but:
  - Removed the "in progress" tag (slice is complete).
  - Added the missing `mapOver` safe-helper (the row only listed
    `fromInput`/`fromStep`/`fromTemplate`/`whenEquals`/`whenContains`/
    `whenTruthy` — `mapOver` was omitted even though `safe-helpers.ts` and
    `transpile.ts` both use it for `StepKind.Map`).
  - Added the two CLI/chat triggers (`bun run crew-builder`, the
    `offer-crew.ts` chat gap-offer) — previously undocumented at the
    module-map level.
  - Added the shared `assertAcyclic` extraction (verified in
    `src/workflow/define.ts:54` — it now has a doc comment explicitly citing
    "the crew-builder IR validator" as a caller).
  - Trimmed the inline 4-defect live-verify walkthrough out of the row (moved
    to the new §19 narrative, referenced via "see §19") to avoid duplicating
    a paragraph-length narrative inside a table cell.
- **New §19** (~150 lines): staged IR-then-transpile rationale, the 13-file
  module map with per-file mechanism notes, the shared `assertAcyclic`
  extraction, `CrewMember.agentRef` + `crewAgentMap` resolution, the two
  triggers, the safety model (review-before-activate / palette-only /
  per-agent auto-build consent / no same-run activation), the mandated
  telemetry note (`crew.build` span, `CREW_BUILD_*` attrs, stage events), the
  full Task-19 live-verify walkthrough (all 4 defects + fixes, verified
  against the actual diffs in `agent-builder/deps.ts`, `plan-edges.ts`,
  `builder.ts`, `transpile.ts`), the known member-scoped-tool-resolution gap,
  and the non-goals (behavioral verification → Slice 20; no serialized
  runtime IR; no triggers/scheduling).

## 2. `README.md`

- Status line replaced (Slice 18 → Slice 19 summary): pipeline shape, staged
  generation, safe-helper vocabulary, two-tier validation, auto-build,
  triggers, live-verify + the 4 defects, condensed Slice 18 recap folded in.
- "Where this is going" intro paragraph: added the Slice 19 clause, moved the
  Phase-D "next" pointer to Slice 20 only (crew/workflow builder is no longer
  "next", it's shipped).
- Slice status table: new row **19** (✅ Done); "Next" row updated to point at
  Slice 20 only (was "crew/workflow builder, then triggers — Slice 19+").
- New feature paragraph (Slice 19) inserted after the existing Slice-18
  paragraph, matching the established per-slice-paragraph style/depth.
- Project-structure table: added a `src/crew-builder/` row (the table didn't
  previously list every subsystem — e.g. `src/crew/`, `src/workflow/`,
  `src/memory/` are also absent — but the task brief specifically asked for
  a crew-builder row given agent-builder already has one, so added it
  alongside `src/agent-builder/`).

## 3. `docs/ROADMAP.md`

- "Honest gap" paragraph: "Eleven more (Slices 8–18)" → "Twelve more (Slices
  8–19)"; "Phase D now has its first slice too" → "three slices"; the false
  "no crew/workflow builder yet" claim removed and replaced with the Slice-19
  summary; "Slice 19+" → "Slice 20" for the remaining Phase-D gap.
- Gap table: new row "Compose a crew/workflow from a need" → ✅ shipped
  (Slice 19).
- Phase-D table: Slice 19 row flipped `(next Phase-D slice)` → ✅ **shipped**,
  with the previously-open "Key design constraint... decided in the slice
  spec" language resolved to state the actual decision (declarative IR +
  deterministic transpiler + safe-helper vocabulary). "Verified works out of
  the box" row's "(Slice 19+)" → "(next Phase-D slice — Slice 20)", and its
  prose corrected to note Slice 19's live-verify proved *one* case, not a
  repeatable per-generation guarantee (the actual scope gap Slice 20 closes).
- Recommended-sequence narrative: new item **9d** (mirrors 9/9c) summarizing
  Slice 19; item **10** (was "next — Slice 19") flipped to ✅ shipped; item
  **11** (Slice 20) is now "— next"; "Committed forward plan (Slices 19–30)"
  heading → "(Slices 20–30)".
- North-star callout: past-tensed the Slice 19 clause, clarified it as
  live-verified.
- Slice-17-follow-ons: struck through the crew/workflow-builder bullet (✅
  shipped, Slice 19) and the "no agent-builder live test" bullet (✅ shipped,
  Slice 19 — `crew-builder.live.test.ts` discharges the shared-path debt per
  the spec's own §7 claim, verified true by reading the test).
- New **"Slice 19 follow-ons"** section: per the full-throttle posture (no new
  deferred features), listed only the 3 logged MINORs from the ledger as
  *opportunistic cleanups* — agent-builder `pascalCase` parallel weakness,
  `assertAcyclic` id-only error messages, `Shape` string-union-not-enum —
  plus the member-scoped-MCP-tool-resolution known gap (already noted in
  `transpile.ts`'s own comment). Explicitly labeled "not deferred features."

## 4. `.superpowers/sdd/progress.md`

Appended a `Task 20` entry (this task) + a `⭐⭐⭐⭐ SLICE 19 LANDING SUMMARY`
entry: all 20 tasks done, the pipeline shape, the 4 live-verify-caught
defects + fixes, the 1 Critical + several Important task-review fixes along
the way, full suite 617 pass/4 skip/0 fail, `docs:check` PASS, and an explicit
note that the Artifact regen + whole-branch final review/merge are deferred
to the controller (not in this task's scope).

## Gate results

- `bun run docs:check` → **PASS** (`✔ docs-check: living docs present +
  linked; every src subsystem documented.`)
- `bun run typecheck` → **PASS** (no code touched by this task)

## Corrections made to a stale/inaccurate claim

The architecture.md module-map row (written incrementally by Task 1 through
Task 19) was accurate but incomplete — the `mapOver` helper and the two CLI
triggers were never added to it as the pipeline grew. Both gaps are now
closed. No other inaccuracy was found in the pre-existing row or in the
Slice-19 ledger entries themselves.

## Note on this filename

`.superpowers/sdd/task-20-report.md` is not namespaced by slice, so it was
previously the Slice-18 Task-20 report (`addPackEntry` atomicity). That
content is preserved in `progress.md`'s Slice-18 section (Task 20 entry,
line ~429) and in git history; this file now holds the Slice-19 Task-20
report only.
