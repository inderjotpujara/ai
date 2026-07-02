## Task 7: Docs (4 surfaces) + SDD ledger

**Files:**
- Modify: `docs/architecture.md` (§14 Telemetry + CLI module map), `README.md` (slice table + status), `docs/ROADMAP.md` (flip Slice 15 follow-on markers), `.superpowers/sdd/progress.md` (append Slice 16 entries)

**Interfaces:** none (documentation).

- [ ] **Step 1: Update `docs/architecture.md`**

In §14 (Telemetry): remove any claim that the `mcp.mount` span is currently a no-op / never lands. State that `src/cli/with-mcp-run.ts` establishes run-dir → telemetry → mount (in that order) so `mcp.mount` (with `mcp.server.count` = mounted servers and `mcp.tool.count` = summed tools, plus per-server `mcp.server.mount` events) reaches `runs/<id>/spans.jsonl`. Add `with-mcp-run.ts` to the CLI module list/map with a one-line responsibility. Note that `runFlow`/`runCrewCli`/`runChat` now receive a `run: RunHandle` and execute within the caller-established scope. Mention the consent predicate now requires both stdin+stderr TTY.

- [ ] **Step 2: Update `README.md`**

Add the Slice 16 row to the slice status table (✅ Done): "MCP telemetry-ordering fix + consent robustness". Update the Status line to reference Slice 16. If any feature paragraph claims mount observability, ensure it now reads as true (it is, post-fix).

- [ ] **Step 3: Update `docs/ROADMAP.md`**

In "Slice 15 follow-ons": mark the `mcp.mount` span/run-telemetry ordering gap and the `mcp.tool.count` rename as ✅ shipped (Slice 16); mark the consent stdin/TTY edge case shipped. Leave GitHub remote-HTTP live-verify and interactive-consent TTY spot-check as outstanding (verification-only) unless done in Task 8. Add a one-line Slice 16 note to the phase table / recommended sequence as appropriate.

- [ ] **Step 4: Append to `.superpowers/sdd/progress.md`**

Append Slice 16 per-task entries (Tasks 1-7), matching the existing ledger format used for Slice 15 (task, what shipped, gate results). Record that the binding condition from the Slice 15 final review is discharged.

- [ ] **Step 5: Commit docs**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs: Slice 16 — mount-span ordering fix + consent robustness across all 4 surfaces + ledger"
```

> After merge, regenerate the snapshot Artifact by hand: add the `with-mcp-run.ts` CLI-helper node, refresh the footer to "16 slices · <final test count>", and hold it to the accuracy bar. (Tooling only reminds; regenerating is manual.)

---

