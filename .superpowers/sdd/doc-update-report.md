# Doc update report — live free-RAM budget + dynamic context sizing

**Commit:** `060317c` — docs: reflect live free-RAM budget + dynamic context sizing; mark Slice 4 shipped  
**Files changed:** README.md, docs/architecture.md, docs/ROADMAP.md, agents/README.md (4 files, +92/-41 lines)  
**Typecheck:** clean (`tsc --noEmit`, 0 errors)  
**Lint:** clean (biome: 0 errors; pre-existing biome.json deprecation warning unchanged)

---

## Per-file summary

### README.md
- Status badge: replaced static "~18 GB budget" with live free-RAM formula (`min(75% Metal cap, 80% available via vm_stat)`, per-delegation), best-effort pinning, dynamic `num_ctx`.
- "What it does (today)" step 1: replaced "~75% of unified RAM" with accurate live-budget description.
- Project structure `src/resource/` row: updated to `hardware.ts (static Metal cap + live free-RAM via vm_stat), footprint.ts (weights + KV split), ollama-control.ts (pull/warm with numCtx/unload/getModelMaxContext)`.
- Roadmap table Slice 4 row: expanded to include live budget + best-effort pin + dynamic num_ctx details. Kept ✅ Done.
- Roadmap Next row: noted the two latent Slice-4 items (live budget, context sizing) are now shipped, unblocking Slice 5.

### docs/architecture.md
- Layers table Resource row: updated to "Live budget (vm_stat), footprint, dynamic num_ctx, warm (with ctx)/unload, model-max probe | Ollama HTTP + os".
- Section 4 "Resource model": fully replaced stale static-budget section with accurate description covering: `liveBudgetBytes` formula + `vm_stat` reclaimable-pages approach (and why `os.freemem()` understates macOS memory); `weightsBytes`/`kvCacheBytes` helpers; per-model `kvBytesPerToken` field; dynamic `num_ctx` formula; `POST /api/show` model-max probe; warm with `options.num_ctx`; same `chosenCtx` for warm + inference; best-effort pin semantics; compact Slice-4 data-flow note.
- Glossary (Section 7): added entries for **Model Manager**, **Live budget**, and **Dynamic num_ctx**.

### docs/ROADMAP.md
- Moved Slice 4 from "In progress / 🔨 building" to the **Shipped** table with status "✅ shipped + live-verified" and updated description (live budget + best-effort pin + dynamic num_ctx).
- Emptied "In progress" section header; added note that Slice 5 is the next active slice, not yet started.
- Slice-5 latent items: item 2 (budget from real sizes) struck out and marked resolved with explanation. Item 1 (propagate ResourceError) kept as still-open.
- Parallel fan-out note: updated to reflect live free-RAM tracking is now reality.
- Deferred items: `hardcoded kvBytesPerToken` struck out and marked resolved.
- Heading renamed "Recommended priority after Slice 4" → "Recommended priority next".

### agents/README.md
- Replaced outdated "Status (Slice 1)" section with current state: three agents (`file-qa.ts`, `web-fetch.ts`, `super.ts`); orchestrator composes others as tools; each references a model declaration; `params.numCtx` is desired context scaled dynamically by Model Manager to fit live free-RAM headroom.
- Removed all "answer-file-question.ts" / "as more agents arrive (Slice 2+)" future-tense framing.

---

## Stale claim verification

Post-edit grep for `~18 GB`, `static 75%`, `~75%`, `hardcoded context`, `hardcoded budget`, `🔨 building`, `In progress` across the four files returned zero stale matches. The two hits found were:
- `docs/architecture.md`: "Slice 4 replaced the **static** 75%-of-total budget" — historical description (correct).
- `README.md`: "no hardcoded budgets or context sizes" — positive assertion of new behavior (correct).
