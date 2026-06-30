# Documentation map

The single index of every maintained document. If you add or rename a living
doc, add it here **and** link it from the root [`README.md`](../README.md) —
the `docs-check` guard fails otherwise.

## The hard line (non-negotiable)

**Documentation stays current with the code. A stale doc is a defect, not debt.**

- **Every slice updates [`architecture.md`](architecture.md)** to reflect what it changed (new module, new data-flow edge, new mechanism) — and updates this map + the root README if it adds/renames a living doc. Each spec/plan carries an **"architecture-doc update"** note next to its **"telemetry to emit"** note.
- **The slice's final review audits the doc against the diff for accuracy** — presence is enforced by tooling, but *truth* is a human/review check (this is how the Slice-9 audit caught 6 wrong edges). Don't just touch the file; verify its claims still match the code.
- Enforced automatically (run `bun run setup` once per clone to activate the git hooks):
  - **pre-commit** → `bun run docs:check`: blocks if a living doc is missing/orphaned or a `src/<subsystem>` is undocumented in `architecture.md`. No false positives.
  - **pre-push** → blocks a push whose commits change `src/**` but not `docs/architecture.md`. Deliberate bypass only: `DOCS_OK=1 git push` (for a genuinely doc-neutral change).
  - Pre-PR gate: `bun run check` (docs-check + typecheck + lint + tests).

## Living docs — kept current

| Doc | What it is |
|---|---|
| [`../README.md`](../README.md) | Product overview, quick start, the pointer hub for everything below. |
| [`architecture.md`](architecture.md) | **Living technical map** — module/dependency graph + runtime data-flow + every subsystem and mechanism. The source of truth for *how the system is wired*. (Interactive snapshot rendered as an Artifact on request.) |
| [`ROADMAP.md`](ROADMAP.md) | Long-range plan — North Star (local-first n8n × CrewAI), phases A–F, the engine line, cross-cutting principles. |
| [`../agents/README.md`](../agents/README.md) | The current agents (super / file-qa / web-fetch) and the capability-requirement pattern. |
| [`../model-images/README.md`](../model-images/README.md) | The local model store (git-ignored), per-machine model blobs, Ollama integration. |

## Historical artifacts — immutable, not "maintained"

Per-slice design records, dated and frozen once their slice ships. They are not
updated after the fact (the living docs above carry the current state).

- [`superpowers/specs/`](superpowers/specs/) — one design spec per slice.
- [`superpowers/plans/`](superpowers/plans/) — one implementation plan per slice.
