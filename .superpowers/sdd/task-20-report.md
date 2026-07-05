# Task 20 report — Slice 21 documentation sweep (all four surfaces + SDD ledger)

## Commit

`5a1a80b` — `docs(slice-21): reliability subsystem across all four surfaces + SDD ledger`
(branch `slice-21-graceful-degradation-retries`)

Staged **exactly** the 5 intended files (verified with `git status --porcelain`
before commit): `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`,
`docs/superpowers/specs/2026-07-05-slice-21-graceful-degradation-retries-design.md`,
`.superpowers/sdd/progress.md`. Did **not** touch the other modified files
already sitting in the working tree (`.remember/*`, various `task-*-brief/report.md`
scratch files from other tasks) — those are pre-existing uncommitted state from
other parts of this slice, out of this task's scope per the brief.

## What I verified before writing (not just the task brief's summary)

- `ls src/reliability/` + `grep -n "^export"` on all 9 files to confirm the
  real exported symbols (`Lane`, `classify`, `CircuitBreaker`/`breakerFor`/
  `resetBreakers`, `withRetry`/`abortableSleep`/`parseRetryAfter`,
  `withWallClock`/`IdleWatchdog`/`withIdleTimeout`, `degradeChain`/
  `failureDomain`, `DegradationLedger`/`DegradeKind`/`createLedger`/
  `formatLedger`/`serializeLedger`, `CircuitOpenError`,
  `defaultDownloadRetry`/`downloadStallMs`).
- `grep -rn "from '.*reliability" src/` to get the **real** cross-file import
  graph (30 call sites) — every mermaid edge I added is sourced from an
  actual import, not inferred from the brief.
- Read `src/provisioning/supervisor.ts` and `src/verified-build/dry-run.ts`
  directly — confirmed both are now literal 2-line re-export files pointing
  at `src/reliability/`, which is what the architecture-doc prose now says.
- Confirmed `src/reliability/ledger.ts`'s exact `DegradeKind` enum values,
  `formatLedger`/`serializeLedger` behavior, and `src/cli/with-mcp-run.ts`'s
  persistence to `run.dir/degradation.jsonl`.
- Confirmed `src/telemetry/spans.ts`'s actual `ATTR.RELIABILITY_*` key names
  and `recordDegrade` — the architecture doc's telemetry claims match these
  exactly (did not invent keys beyond what the file defines).
- Read the SDD ledger's existing Slice-21 task history to confirm the
  already-recorded §11 decision text (Task 19b's `§11 DECISION` note) so the
  spec-file update and the landing summary don't contradict it.

## Per-surface changes

**`docs/architecture.md`**
- Expanded the `REL` mermaid subgraph (§2) from a config-only stub to all 9
  files with one-line responsibilities.
- Added ~30 new mermaid edges (grep-verified) covering: `classify→retry/
  breaker/degrade`; `delegate/agent/workflow/crew/mcp/selector/provisioning/
  verified-build` consuming reliability; `ledger→spans`.
- Rewrote the §2 layer-table **Reliability** row from a one-line config
  description into the full subsystem (all 9 files, wiring, migrations).
- Updated node labels for `provsup` (supervisor.ts) and `vbdry` (dry-run.ts)
  to say "re-exports reliability ...".
- Updated the Provisioning table row, the §13 "Supervisor guards" section,
  and the §20 dry-run prose to say retry/stall/wall-clock now come from
  `src/reliability` (not reimplemented locally).
- Added new **§21 "Reliability — graceful degradation + retries"** — taxonomy,
  D5 no-double-retry rationale, per-file table, ledger mechanics, wiring,
  migrations, telemetry, the recorded §11/OWASP-ASI08 decision, and
  testing/live-verify (823 pass/6 skip/0 fail).

**`README.md`**
- Status line flipped to Slice 21 (Phase A closed); the old Slice-20 status
  paragraph kept as a "**Previously:**" continuation (not deleted — Phase D
  narrative stays intact).
- Top "where this is going" blurb updated: Slice 21 folded into the Phase-D
  sentence, "Next" now points at Slice 22.
- New slice-table row **21** (✅ Done) before the "Next (product line)" row;
  that row's "**A** reliability..." leg was removed since it's shipped,
  leaving **C** Codex (22) as the lead item.

**`docs/ROADMAP.md`**
- n8n/CrewAI gap table: `Reliability / retries` row ❌→✅ shipped (Slice 21).
- Phase-A table: `Graceful degradation` row flipped to shipped with a full
  description + live-verify note.
- Recommended-sequence item 12: "in progress" → ✅ shipped, full narrative +
  the recorded §11 decision + test count; item 13 (Codex, Slice 22) tagged
  "— next".
- Closing backlog note: "next slice" 21 → 22.
- **New row 37** appended to the existing (uncommitted, user-authored)
  "Backlog beyond Slice 30" table for the OWASP-ASI08 downstream
  degradation-taint candidate slice — the table's intro paragraph, the
  existing rows 31-36, and the closing "Slices 32-35 follow..." sentence
  were **left untouched**, per the brief's explicit instruction. Confirmed
  with `git diff` that only one new table row was added, nothing else in
  that block changed.

**Spec `docs/superpowers/specs/2026-07-05-slice-21-graceful-degradation-retries-design.md` §11**
- Flipped from "not yet a decision" to the recorded decision: shipped
  observability-complete in-slice (ledger + newly-emitted
  `DegradeKind.Retried`); the `degraded: true` downstream taint marker is
  deferred to its own future slice, referenced as candidate Slice 37 in
  ROADMAP.

**`.superpowers/sdd/progress.md`**
- Appended a `Task 20 (docs sweep): complete` entry detailing exactly what
  was verified/changed per surface.
- Appended a `⭐⭐⭐⭐ SLICE 21 LANDING SUMMARY` covering all 20+1 tasks
  (including the mid-slice Task 19b addition from the §11 decision), the
  Task-5 CRITICAL (IdleWatchdog silent-stall gap) and the Task-10 real
  regression (Transient-only retry silently broke provisioning's
  unconditional retry) caught and fixed in-slice, gate status
  (`docs:check` PASSES, full suite 823 pass/6 skip/0 fail), and NEXT steps
  (final review → merge → Slice 22).

## Verify

`bun run docs:check` → **PASSES** (`✔ docs-check: living docs present + linked;
every src subsystem documented.`) — ran once standalone and again via the
pre-commit hook on `git commit`.

Per the task's global constraint, the full test suite was **not** run (this
is a docs-only change).

## Note

This exact path (`.superpowers/sdd/task-20-report.md`) previously held a
stale report from Slice 19's own "Task 20" docs sweep (task numbers restart
per slice). It has been overwritten with this slice's report; nothing else
in `.superpowers/sdd/` scratch was touched.

## Confirmation: user's ROADMAP backlog block is intact

Verified via `git diff docs/ROADMAP.md` that the existing "Backlog beyond
Slice 30 (Slices 31–35, +36)" block — its intro paragraph, all of rows
31–36, and the closing "Slices 32–35 follow the same cycle..." sentence —
is byte-for-byte unchanged except for one new appended row (**37**,
downstream degradation-taint). Nothing in that block was removed or
rewritten.
