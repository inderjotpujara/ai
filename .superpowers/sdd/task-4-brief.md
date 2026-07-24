### Task 4: Increment 1 boundary gate

- [ ] **Step 1: Run the full gate** — `bun run check`. Fully green including docs-check (the Task-3 stub satisfies the subsystem-documented check; no exemption needed at any gate this slice).
- [ ] **Step 2: Record the increment in the SDD ledger** (`.superpowers/sdd/progress.md`) with per-task commit refs.

*Model: controller (no code).*

---

## Increment 2 — D3 kind + re-eval engine

Adds the `Eval` JobKind, factors the golden-eval binding into ONE shared helper, builds the generation-free `reevalArtifact`, and wires the dispatch case + turn.

