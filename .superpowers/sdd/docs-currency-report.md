# Docs currency pass — Slices 8–10 catch-up

Scope: README.md + docs/ROADMAP.md only. architecture.md and src/** untouched. No commit made.

## git diff --stat

```
README.md       | 37 +++++++++++++++++++++++++++++--------
docs/ROADMAP.md | 34 +++++++++++++++++++---------------
2 files changed, 48 insertions(+), 23 deletions(-)
```

## docs:check result

```
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
Exit code 0 — passes.

---

## README.md changes

1. **Intro blurb** ("Where this is going") — updated "Slices 1–7 built the
   hardware-aware engine; the next phase builds the product" framing to note
   Slice 8 (run-viewer), Slice 9 (guardrails), Slice 10 (workflow engine) have
   landed and the product line is underway.

2. **Status line** (top banner):
   - Before:
     > **Status:** Slice 7 complete — **KV-cache quantization**. `bun run serve` sets
     > `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` (default); the manager
     > sizes context per-model from live arch data (`/api/show`) and warns on arch-risky
     > models. Built on Slice 6's model discovery. See [Roadmap](#roadmap).
   - After:
     > **Status:** Slice 10 complete — **workflow/DAG engine**. `defineWorkflow()` +
     > `bun run flow <name>` run deterministic, code-first, typed step graphs
     > (agent/tool/branch/map) beside the existing LLM router. Also shipped: Slice 8
     > (OTel run-viewer, `bun run runs`) and Slice 9 (composition guardrails —
     > delegation depth limit + return-size cap). See [Roadmap](#roadmap).

3. **New feature paragraphs** added after the existing Slice 7 (KV-cache
   quantization) paragraph, matching the same voice/format:
   - Run-viewer / OpenTelemetry telemetry (Slice 8)
   - Composition guardrails (Slice 9)
   - Workflow / DAG engine (Slice 10)

4. **Quick start** — added a `bun run flow` / `bun run runs` example block
   right after the existing `chat.ts` example, so both are discoverable.

5. **Slice status table** (was ending at Slice 7 + a single "Next (product
   line)" planned row) — added rows for Slice 8, 9, 10 as `✅ Done`, and
   reworded the "Next (product line)" row to start from "continuing Phase B:
   crews & roles → memory/RAG → grounded verification" instead of listing the
   workflow engine as still-planned.
   - Before (last two rows):
     ```
     | **7** | ... | ✅ Done |
     | **Next (product line)** | Toward a local **n8n × CrewAI**, in phases: **A** see/trust (run-viewer · graceful degradation · eval) → **B** compose (composition guardrails · workflow/crew engine · **memory/RAG** · **grounded verification**) → **C** connect (...) → **D** grow (...) → **E** automate (...) → **F** breadth on-demand (...) | Planned |
     ```
   - After:
     ```
     | **7** | ... | ✅ Done |
     | **8** | **Run-viewer / OTel telemetry** (Phase A) — ... | ✅ Done |
     | **9** | **Composition guardrails** (Phase B prerequisite) — ... | ✅ Done |
     | **10** | **Workflow / DAG engine** (Phase B) — ... | ✅ Done |
     | **Next (product line)** | Toward a local **n8n × CrewAI**, continuing Phase B: **crews & roles** → **memory/RAG** → **grounded verification** → **C** connect (...) → **D** grow (...) → **E** automate (...) → **F** breadth on-demand (...) | Planned |
     ```

No changes made to the "Project structure" table, "Architecture at a glance"
diagram, or "Why Ollama" sections — out of the requested scope and not part
of the ground-truth items to flip.

---

## docs/ROADMAP.md changes

1. **Capability-gap table** (the "honest gap" table):
   - `Workflow / DAG (deterministic steps)` row:
     - Before: `❌ **the defining gap**`
     - After: `✅ **built (Slice 10)**`
   - Also corrected two adjacent rows in the same table that ground truth
     shows shipped as a byproduct of Slices 8 and 10 (not explicitly called
     out in the task list but directly falsified by the ground truth given,
     so fixed for accuracy):
     - `Structured data between steps` — `❌ not built` → `✅ built (Slice 10 — Zod-validated step I/O)`
     - `Execution view / run history` — `❌ not built` → `✅ built (Slice 8 — OTel trace + \`bun run runs\`)`
   - Left untouched (still correctly marked not-built per ground truth):
     Crews (🟡 partial), Triggers, Create-a-node/agent-builder, Memory/RAG,
     Grounded verification, Reliability/graceful degradation.

2. **Intro paragraph above the gap table** ("Seven shipped slices...") —
   updated to mention Slices 8–10 have landed the first wave of the product
   pivot, while noting the product surface (agents, crews, memory,
   verification) is still thin beyond that.

3. **Phase A table** — Run-viewer row: appended ` — ✅ **shipped (Slice 8)**`
   to the Item cell (kept the "Why now" text describing the mechanism as-is,
   since it remains an accurate description of what shipped).

4. **Phase B table**:
   - Composition guardrails row: appended ` — ✅ **shipped (Slice 9)**` to the
     Item cell; rewrote the description to match what actually shipped
     (`AsyncLocalStorage` delegation context, depth limit default 5 with
     `AGENT_MAX_DELEGATION_DEPTH`, return-size cap ¼×`num_ctx` with
     `AGENT_RETURN_CTX_FRACTION`, `agent.guardrail.violation` span event) —
     removed the earlier "cross-agent cycle detection" claim since ground
     truth for Slice 9 does not list cycle detection as shipped (only depth
     limit + return cap + soft-error surfacing).
   - Workflow / DAG engine row: appended ` — ✅ **shipped (Slice 10)**` to the
     Item cell; rewrote description to match shipped reality
     (`defineWorkflow`, step kinds, Zod I/O, fail-fast/onError, `bun run flow`,
     `workflows/` registry, `runWorkflow()`, shared `runGuardedAgent` reuse of
     Slice 9 guardrails).
   - Left untouched (still planned, not shipped): Crews & roles, Memory/RAG,
     Grounded generation + verification, Structured/response-format I/O item
     description (the table row itself, not the gap-table row above).

5. **Recommended sequence** list (below the tables) — marked items 1–3
   (run-viewer, guardrails, workflow/DAG engine) as ✅ shipped with slice
   numbers, and split what was previously a combined "workflow/crew engine +
   memory + grounded verification" step into a separate now-current step 4:
   "Crews + memory (RAG) + grounded verification (Phase B, next)". Renumbered
   subsequent Phase C/D/E steps 5–7 accordingly.

No changes to: Foundation (Slices 1–7) table, Phase C/D/E/F tables, Engine
line section, Alternate runtimes section, Deferred technical items section,
cross-cutting design-principle callouts (grounded-by-default,
observable-by-default).
