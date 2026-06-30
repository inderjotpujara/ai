# Project rules — local-agent framework (~/ai)

Global dev workflow (bun, browser, code style, quick commands) lives in the
user-level CLAUDE.md. This file holds the **repo-specific** rules. The full
technical map is [`docs/architecture.md`](docs/architecture.md); the doc index
is [`docs/README.md`](docs/README.md).

## Documentation — the hard line (non-negotiable)

**Documentation stays current with the code. A stale doc is a defect, not debt.**
We cannot afford to ship a change that the docs don't reflect.

- **Every slice updates [`docs/architecture.md`](docs/architecture.md)** to reflect what it changed — a new module, a new data-flow edge, a new mechanism/formula. If it adds or renames a *living* doc, also update the [documentation map](docs/README.md) and the root README pointer.
- **Every spec and plan carries two standing notes:** an **"architecture-doc update"** note and a **"telemetry to emit"** note (see [`docs/ROADMAP.md`](docs/ROADMAP.md) "observable by default").
- **The slice's final review audits the doc against the diff for accuracy** — not just "was the file touched," but "do its claims still match the code." (Presence is enforced by tooling; *truth* is the review's job. This is how the Slice-9 audit caught 6 wrong edges.)
- **The interactive architecture snapshot Artifact** is regenerated/verified from `architecture.md` when the architecture changes, and is held to the same accuracy bar.

### Enforced automatically
- Run **`bun run setup`** once per clone to activate the git hooks (`.githooks/`, via `core.hooksPath`).
- **pre-commit** → `bun run docs:check`: blocks if a living doc is missing/orphaned or a `src/<subsystem>` is undocumented in `architecture.md`.
- **pre-push** → blocks a push whose commits change `src/**` but not `docs/architecture.md`. Deliberate bypass only (genuinely doc-neutral change): `DOCS_OK=1 git push`.
- **Pre-PR / pre-merge gate:** `bun run check` (docs-check · typecheck · lint · tests). Don't merge red.

## Don't
- Commit without `bun run typecheck`; skip tests; leave `console.log`.
- Ship a `src/**` change without updating `docs/architecture.md` (or a conscious, justified `DOCS_OK=1`).
- Hardcode model choices, budgets, or limits — compute live; env vars are fallback-only.
