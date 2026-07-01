# Docs currency pass — Slice 11 (crews & roles)

## Files changed

- `README.md`: +18 / -10 lines
- `docs/ROADMAP.md`: +13 / -11 lines
- `docs/architecture.md`: untouched (already current, per instructions)
- No `src/**` changes.

## README.md — status line

**Before:**
> **Status:** Slice 10 complete — **workflow/DAG engine**. `defineWorkflow()` +
> `bun run flow <name>` run deterministic, code-first, typed step graphs
> (agent/tool/branch/map) beside the existing LLM router. Also shipped: Slice 8
> (OTel run-viewer, `bun run runs`) and Slice 9 (composition guardrails —
> delegation depth limit + return-size cap). See [Roadmap](#roadmap).

**After:**
> **Status:** Slice 11 complete — **crews & roles**. `defineCrew()` +
> `bun run crew <name>` compose role/goal/backstory members and dependent tasks
> into a **sequential** (compiled to a Slice-10 workflow DAG) or **hierarchical**
> (orchestrator + auto manager) process, with live largest-that-fits model
> selection now wired into both the `flow` and `crew` CLIs. Also shipped: Slice 8
> (OTel run-viewer, `bun run runs`), Slice 9 (composition guardrails —
> delegation depth limit + return-size cap), and Slice 10 (workflow/DAG engine,
> `bun run flow <name>`). See [Roadmap](#roadmap).

## README.md — other edits

- Intro blurb: "Phase B's composition guardrails (Slice 9) and workflow/DAG
  engine (Slice 10) have landed. Remaining Phase B work (crews, memory/RAG,
  grounded verification) …" → now lists Slice 11 (crews & roles) as landed;
  "Remaining Phase B work" narrowed to memory/RAG + grounded verification.
- Added a new **Crews & roles (Slice 11)** feature paragraph (same voice as
  the Slice 8/9/10 paragraphs), covering `defineCrew`, members
  (role/goal/backstory/requires/prefer/tools), tasks (dependsOn/output),
  sequential vs. hierarchical processes, guardrail reuse, `crew.run`/`crew.step`
  telemetry, `bun run crew <name>`, the `crews/` registry + `research-crew`
  example, and the shared `src/cli/select-runtime.ts` live-selection wiring.
  Links to `docs/architecture.md` §10.
- Quick-start commands: added `bun run crew research-crew "..."` next to the
  existing `bun run flow` example.
- Slice status table: added a **Slice 11** row (✅ Done); "Next (product line)"
  row updated so crews are no longer listed as upcoming — next is
  memory/RAG → grounded verification → Phase C onward.

## docs/ROADMAP.md — capability-gap table

**Before:**
> | **Crew (role + goal + task + process)** | crews / roles / tasks | 🟡 composition exists; needs the task/process layer |

**After:**
> | **Crew (role + goal + task + process)** | crews / roles / tasks | ✅ built (Slice 11) |

## docs/ROADMAP.md — other edits

- "Honest gap" prose: "Three more (Slices 8–10) have … no crews, memory, or
  grounded verification yet" → "Four more (Slices 8–11) have … and no memory
  or grounded verification yet" (crews removed from the gap list).
- Phase B table: **Crews & roles** row marked ✅ **shipped (Slice 11)**, with
  a shipped-style description matching the Slice 9/10 rows' format (⭐ + status
  in the Item cell, mechanism detail in the Why cell).
- Recommended sequence: added item 4 "✅ Crews & roles (Phase B) — shipped,
  Slice 11 …"; renumbered "Crews + memory (RAG) + grounded verification" down
  to item 5, reworded to drop crews ("Memory (RAG) + grounded verification …
  next"); renumbered the remaining Phase C/D/E items to 6/7/8.

## docs:check result

```
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```

Passed (no changes to `docs/architecture.md` or `src/**`, so the subsystem
coverage check was unaffected).
