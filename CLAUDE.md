# Project rules — local-agent framework (~/ai)

Global dev workflow (bun, browser, code style, quick commands) lives in the
user-level CLAUDE.md. This file holds the **repo-specific** rules. The full
technical map is [`docs/architecture.md`](docs/architecture.md); the doc index
is [`docs/README.md`](docs/README.md).

## Documentation — the hard line (non-negotiable)

**Documentation stays current with the code. A stale doc is a defect, not debt.**
We cannot afford to ship a change that the docs don't reflect.

- **Every slice updates ALL FOUR living surfaces (non-negotiable, this is the hard line):**
  1. **[`docs/architecture.md`](docs/architecture.md)** — the module/data-flow/mechanism it changed (+ the [doc map](docs/README.md) & README pointer if it adds/renames a *living* doc).
  2. **Root [`README.md`](README.md)** — the **Status line**, the **slice status table** (add the new slice row, ✅ Done), and any feature paragraph / "Next" line so the product surface reads current.
  3. **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — flip the shipped capability's status marker (🟡/❌ → ✅ shipped, Slice N) in the gap table, the phase table, and the recommended sequence.
  4. **The interactive architecture snapshot Artifact** ("docs snapshot") — **regenerated from `architecture.md`** (new subsystem node/edges, updated footer slice count + test count), held to the same accuracy bar. It is not a repo file, so tooling can only *remind* — regenerating it is on you.
- **Every spec and plan carries two standing notes:** an **"architecture-doc update"** note and a **"telemetry to emit"** note (see [`docs/ROADMAP.md`](docs/ROADMAP.md) "observable by default").
- **The slice's final review audits the docs against the diff for accuracy** — not just "was the file touched," but "do its claims still match the code." (Presence is enforced by tooling; *truth* is the review's job. This is how the Slice-9 audit caught 6 wrong edges.) README/ROADMAP drift after Slices 10–11 is exactly what this rule + the pre-push slice-landing gate now prevent.

### Enforced automatically
- Run **`bun run setup`** once per clone to activate the git hooks (`.githooks/`, via `core.hooksPath`).
- **pre-commit** → `bun run docs:check`: blocks if a living doc is missing/orphaned or a `src/<subsystem>` is undocumented in `architecture.md`.
- **pre-push** → (a) blocks a push whose commits change `src/**` but not `docs/architecture.md`; (b) **slice-landing gate** — a push **to main** that changes `docs/architecture.md` (= a slice shipped) is blocked unless `README.md` **and** `docs/ROADMAP.md` are updated in the same push (and it reminds you to regenerate the Artifact). Deliberate bypass only (genuinely not a slice, e.g. a typo): `DOCS_OK=1 git push`.
- **Pre-PR / pre-merge gate:** `bun run check` (docs-check · typecheck · lint · tests). Don't merge red.

## Don't
- Commit without `bun run typecheck`; skip tests; leave `console.log`.
- Ship a `src/**` change without updating `docs/architecture.md` (or a conscious, justified `DOCS_OK=1`).
- Hardcode model choices, budgets, or limits — compute live; env vars are fallback-only.
