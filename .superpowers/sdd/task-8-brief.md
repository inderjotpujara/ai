## Task 8: docs (4 surfaces) + SDD ledger

**Files:**
- Modify: `docs/architecture.md` (new §18), `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: `docs/architecture.md` — add §18 "Agent-builder (Slice 17)"**

Document: the `agents/index.ts` registry (factories keyed by name; `super`/`chat`/`flow` build from it); the `src/agent-builder/` units (types, generate [prompt-injection-guarded], suggest-tools [palette-only], validate [structural], write [atomic file + index markers + scoped mcp.json], builder [generate→suggest→validate→consent→write], deps [live largest-that-fits tools model]); the two triggers (`bun run agent-builder` + TTY gap-offer); the safety model (review-before-activate, palette-only, no same-run activation); and the `agent.build` span + `agent.build.*` attributes. Add `src/agent-builder/` and `agents/index.ts` to the module map. Note the gap seam is now an additive TTY branch (the `{kind:'gap'}` outcome + its `agent.gap.missing_capability` attribute are unchanged).

- [ ] **Step 2: `README.md`**

Add the Slice 17 row to the slice table (✅ Done): "Agent-builder (Phase D) — generate a specialist on a capability gap". Update the Status line to Slice 17. Add a feature paragraph. Add `agents/index.ts` + `src/agent-builder/` to the project-structure table. Update the test count (run `bun test` for the number).

- [ ] **Step 3: `docs/ROADMAP.md`**

Flip Agent-builder ❌/🟡 → ✅ shipped (Slice 17) in the gap table (line ~59), the Phase D table (line ~146), and the recommended-sequence (line ~217, item 9). Add a "Slice 17 follow-on" note: crew/workflow builder (composes existing + generated agents) as the next Phase-D slice; execution dry-run + golden-eval + reuse/archive as the path to a *verified* "works out of the box". State the north-star (chat → any agent/crew out of the box).

- [ ] **Step 4: Append the Slice 17 summary to `.superpowers/sdd/progress.md`**

Per-task entries + a slice summary (what shipped, suite result). Note this is the first Phase-D slice.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs: Slice 17 — Agent-builder across all 4 surfaces + ledger"
```

> After merge, regenerate the snapshot Artifact by hand: add an **Agent-builder** node (`src/agent-builder`) + edges cli→builder, builder→pack (palette), builder→agents-registry, builder→telemetry; a "Grown deliberately" concept card; footer → "17 slices · <final test count>".

---

