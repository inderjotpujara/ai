## Task 3: Decision record — adopt `@ai-sdk/workflow` vs. custom per-node checkpoint store

**Files:**
- Create: `docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md`
- Modify: this plan file — set the Increment 6 "SELECTED PATH" marker (Task 40's header) to the decision's outcome.

**Interfaces:**
- Consumes: the Task 2 spike transcript + Task 1 peer-range result.
- Produces: a single machine-checkable verdict — `SUBSTRATE = adopt` or `SUBSTRATE = custom` — that Increment 6 (Task 40/41) branches on. D5 pre-commits BOTH paths, so the deliverable (resume at DAG-node granularity) is fixed either way.

- [ ] **Step 1: Write the decision record**

`docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md` must contain, in order: (1) the question (D5c / §7.2), (2) the Task 2 transcript, (3) the peer-range result, (4) the answers to the three spike questions — runs local-first? filesystem store, no Vercel? wraps-or-replaces our `src/workflow/` engine? — (5) the verdict line, EXACTLY one of:
```
SUBSTRATE = adopt   (Increment 6 uses WorkflowAgent resume — Task 40a/41a)
SUBSTRATE = custom  (Increment 6 uses src/workflow/checkpoint.ts — Task 40b/41b)
```
(6) a one-paragraph rationale.

- [ ] **Step 2: Stamp the Increment 6 header**

Edit this plan's Increment 6 "SELECTED PATH" line (below) to name the chosen path so the executor cannot miss it.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/decisions/2026-07-19-slice-24-resume-substrate.md docs/superpowers/plans/2026-07-19-slice-24-daemon-queue-remote.md
DOCS_OK=1 git commit -m "docs(queue): Slice 24 resume-substrate decision record (Incr 1 gate)"
```
(`DOCS_OK=1`: a `docs/superpowers/` decision record + plan edit is not a slice landing.)

## Task 3b: Boundary gate — Increment 1

**Files:** none (verification only).

- [ ] **Step 1: Run the full root gate**

```bash
bun run typecheck && bun run lint && bun run test
```
Expected: PASS. The spike test lives under `spikes/` and is NOT run by `bun run test` (which the normal suite scopes to `tests/` + `src/`); if it is picked up, exclude `spikes/**` the same way `web/**` is excluded in the `test` script. The decision record's verdict line is set. No `src/**` changed yet — nothing to break.

---

# Increment 2 — Queue core (`src/queue/`, SQLite jobs store + bounded worker pool)

**Purpose (spec §5.2, D6):** the persistent job control plane. SQLite `jobs` table mirroring `src/session/store.ts` (WAL + `busy_timeout=5000` + `foreign_keys=ON`, `user_version` migrations via `src/db/migrate.ts`, `INSERT OR IGNORE` idempotency, `db.transaction()` atomicity, base64url keyset pagination, snake_case↔camelCase mappers). Scheduler + bounded worker pool (N from hardware, env-override) + priority lanes + retry reusing `src/reliability/`. **No HTTP yet** — unit-tested against a temp SQLite db (mirrors the `SessionStore` test precedent). Closes deferred items 7 (concurrent-launch cap = the pool) and 11 (persistence chartered out of Slice 21). This increment's spans (item 18) are added in Increment 4 once the daemon owns the tracer.

