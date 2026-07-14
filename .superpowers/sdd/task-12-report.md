# Task 12 report (Slice 30b Phase 1): `## Contracts` + `## Server (web BFF)` subsystem sections

*(Note: this path previously held a Slice-29 report for a differently-scoped
Task 12 — "docs: §Voice architecture + README/ROADMAP/ledger", which itself
had overwritten a Slice-26 report before that. Overwritten here per that
report's own file-reuse convention: per-slice Task-N reports share the same
filename, so each slice's Task 12 report replaces the last.)*

**Commit:** `6cea19b` — `docs(architecture): add Contracts + Server (web BFF)
subsystem sections (Slice 30b Phase 1)` (1 file changed, 59 insertions, 2
deletions, `docs/architecture.md` only)

## What was done

1. **Confirmed baseline.** `bun run docs:check` already PASSED before any
   edit — the minimal placeholder rows added during Tasks 1 and 6 (in the
   "Layer" table under `## 2. System map`, lines ~531–532) already contain
   the substrings `src/contracts` and `src/server`, which is all
   `scripts/docs-check.ts` rule 3 requires (a simple per-`src/<subsystem>`
   substring check). This matches the task framing exactly — the brief's
   Step 1 ("confirm docs-check FAILS") described the state *before* Tasks 1/6
   landed; by Task 12 those rows already exist so the check passes going in.

2. **Appended the two full sections verbatim from the brief** at the end of
   `docs/architecture.md` (after `## 23. Voice input (STT) (Slice 29)`, the
   last content in the file, previously ending at line 3065): `## Contracts
   (web wire protocol — src/contracts/, Slice 30b Phase 1)` and `## Server
   (web BFF — src/server/, Slice 30b Phase 1)`, each with **Feature** /
   **Mechanism** / **Data flow** subsections. Verified every named file
   against the actual shipped tree before writing:
   - `src/contracts/`: `enums.ts`, `dto.ts`, `events.ts`, `requests.ts`,
     `index.ts` — matches `tests/contracts/{enums,dto,events,requests,
     isomorphic,degrade-kind-parity}.test.ts` on disk.
   - `src/server/`: `main.ts`, `app.ts`, `security/{token,origin,
     media-path}.ts` — matches `tests/server/{main,app,token,origin,
     media-path}.test.ts` on disk.
   - No mention of the chat/SSE handler, DTO mappers, or the `web/` frontend
     (correctly scoped to what Tasks 1–11 shipped, not later phases — the
     brief is explicit these attach later).
   - Followed the doc's existing precedent of appending unnumbered top-level
     `##` sections after the last numbered section (Slice 30a content was
     also folded into the doc without new section numbers elsewhere), per
     the brief's exact instruction to add "a new top-level `##` section
     each" with no numbering.

3. **Reconciled the minimal Task-1/Task-6 table rows** — kept them (they are
   part of the same registry table `docs-check` substring-matches against,
   and the doc's own convention elsewhere — e.g. the Voice/Media/Process
   rows — is "short table summary + full section below," not one-or-the-
   other) but rewrote their prose from a stale narrower snapshot into an
   accurate summary that points at the new full sections:
   - Contracts row previously described only `enums.ts` + the isomorphic
     rule, as if Tasks 2–4 hadn't yet shipped `dto.ts`/`events.ts`/
     `requests.ts`/`index.ts`. Now lists all five files and says "full
     section below."
   - Server row previously said "Tasks 6+ … per-session bearer token" only
     (stale as of Task 6, before Tasks 7–11 shipped the Host/Origin
     allowlist, media-path confinement, `/api/health`, COOP/COEP static
     serving, the `server.request` span, and the `bun run web` entry). Now
     summarizes the full shipped Phase-1 surface and says "full section
     below."
   - No duplicated/contradictory claims remain: each subsystem's facts
     appear once in full (the new sections) and once as a short pointer
     summary (the table), consistent with the rest of the document.

## docs:check output

```
$ bun run docs:check
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
PASS, both before and after the edit (exit 0), and again as the pre-commit
hook on `git commit`.

## typecheck output

```
$ bun run typecheck
$ tsc --noEmit
```
PASS, exit 0 (docs-only change, no code touched — confirms no regression).

## Self-review

- Compared every claim in the new sections against the actual files on disk
  (`ls src/contracts src/server src/server/security tests/contracts
  tests/server`) before writing — all named files exist exactly as
  described, nothing invented.
- Confirmed the brief's prose doesn't claim anything from later phases
  (chat/SSE handler, DTO mappers, `web/` frontend, persistence/
  `SessionStore`) — it explicitly calls those out as attaching "in later
  phases." Verified the reconciled table rows also don't smuggle in
  later-phase claims.
- Re-read the table rows and new full sections side by side after editing —
  no duplicate/contradictory content remains.
- `git diff` on the final commit confirms only `docs/architecture.md` was
  touched, only in the two intended spots (two table-row edits near line
  531–532; one append at end of file).
- Did **not** touch the many other modified files already present in the
  working tree at task start (`.remember/*`, `.superpowers/sdd/task-*-brief.md`,
  `.superpowers/sdd/task-*-report.md`, `.superpowers/sdd/progress.md`) —
  those are other tasks'/agents' in-flight state, out of scope for a
  docs-only Task 12, and were left exactly as found (not staged, not
  committed).

## Concerns

- **`bun run check` (the brief's "Final gate (run after Task 12)" step) does
  NOT currently pass** — but the failure is pre-existing Biome lint/format
  noise (24 errors / 15 warnings: arg-wrapping style, import ordering) in
  `tests/contracts/*.test.ts` and `tests/server/*.test.ts` shipped by
  Tasks 1–11, **not introduced by this task**. Verified by `git stash`-ing
  my change and re-running `bun run lint` against the pre-Task-12 tree:
  identical 24 errors / 15 warnings appear with or without my docs edit.
  Task 12's own mandatory gates — `docs:check` and `typecheck` — both pass
  cleanly. Fixing those pre-existing test-file lint issues is outside a
  docs-only task's scope (and outside the file set I was asked to touch);
  flagging so the orchestrator can route it to whichever task/agent owns
  those test files before the Phase-1 `bun run check` gate is declared
  green.
