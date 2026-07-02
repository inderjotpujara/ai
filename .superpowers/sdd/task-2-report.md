# Task 2 Report: Consent store + hashing + prompt flow (Slice 15)

## What was built

Two new source files and one test file, all verbatim from the brief (with Biome auto-format applied—line-wrapping and import-order only, no logic changes):

1. **`src/mcp/consent.ts`** (176 lines)
   - `specHash(entry)` — SHA256 of canonical raw config fields: stdio `{command, args, envKeys(sorted)}`, HTTP `{url, headerNames(sorted)}`. Hashes NAMES only, never secret VALUES.
   - `toolsHash(tools)` — SHA256 of sorted `name|description|inputSchemaJson` triples. The rug-pull detection pin.
   - `type ApprovalRecord` — Approval with `specHash`, optional `toolsHash`, `approvedAt` timestamp, optional `declined` flag.
   - `readApprovals(path?)` / `writeApprovals(store, path?)` — Atomic read/write to `.mcp-approvals.json` (default path: `process.cwd()`). Write uses temp+rename to prevent corruption on failure. Read degrades gracefully on missing/corrupt file.
   - `describeEntry(entry)` — Human-readable from raw (unexpanded) config—shows exact command line or URL + header names, never secret values.
   - `dangerFlags(entry)` — Pattern-based safety check for `sudo`, `rm -rf`, `curl|sh`, `wget|sh`.
   - `type ConsentDeps` — Dependencies for the consent gate: `store` (read/write), `ask` callback, `isTTY` boolean, `autoYes` flag, `warn` callback.
   - `ensureConsent(entry, deps)` — Interactive consent gate. Mutates `deps.store`; caller persists it. Non-TTY without `autoYes` skips (returns false) with a warning—NEVER hangs. On first mount or spec-hash drift, prompts with danger flags highlighted. Remembers declines and doesn't re-prompt on same spec.
   - `pinTools(store, name, hash)` — Records tool-definition hash at mount.
   - `checkDrift(store, name, hash)` — Detects tool-definition changes (returns true if changed).

2. **`.gitignore` update**
   - Added `.mcp-approvals.json` to ignored files (machine-local trust store, never committed).

One test file:
- `tests/mcp/consent.test.ts` (179 lines, 13 tests)

## TDD evidence (RED → GREEN)

**Step 1–2 (Failing tests):**
- RED: `bun test tests/mcp/consent.test.ts` → error: `Cannot find module '../../src/mcp/consent.ts'`, 0 pass / 1 fail.

**Step 3–4 (Implementation + pass):**
- GREEN: after creating `src/mcp/consent.ts` with exact brief code → 13 pass, 0 fail, 24 expect() calls.

**Step 5–6 (Gitignore + typecheck + lint):**
- `.gitignore` updated with `.mcp-approvals.json` entry.
- `bun run typecheck` → clean (tsc --noEmit, no output).
- `bun run lint:file -- "src/mcp/consent.ts" "tests/mcp/consent.test.ts"` → Checked 2 files. After Biome auto-fix (line-wrapping + import-order only, no logic change):
  - One linting warning: template string placeholder in test (line 35: `'Bearer ${T}'` → changed to `` `Bearer \${T}` ``).
  - Final lint run: clean.

**Step 7 (Commit):**
```
git add src/mcp/consent.ts tests/mcp/consent.test.ts .gitignore
git commit -m "feat(mcp): consent-on-mount store with spec hashing + tool-definition pinning (Slice 15 Task 2)"
[slice-15-mcp-mounts e9159ad] feat(mcp): consent-on-mount store with spec hashing + tool-definition pinning (Slice 15 Task 2)
 3 files changed, 358 insertions(+)
```
Pre-commit `docs-check` hook passed (confirmed no living docs broken).

## Test Coverage (13 tests)

Each test suite covers key consent-store behaviors:

**specHash (2 tests)**
- Stability across secret-value changes (HTTP Authorization header with different bearer token values hash identically).
- Change detection when spec fields change (command/URL modifications result in different hashes).

**toolsHash (1 test)**
- Description change detection (rug-pull pin: tool definition drift triggers new hash).

**Approval store round-trip (1 test)**
- Atomic write/read with temp+rename.
- Graceful degradation on missing file (returns empty object).

**ensureConsent flow (6 tests)**
- First mount: prompts and records `specHash`.
- Cached approval: matching spec-hash skips re-prompt.
- Spec drift: hash mismatch triggers re-prompt.
- Decline memory: declined servers not re-prompted on same spec.
- Non-TTY without autoYes: skips silently (returns false, no store mutation).
- autoYes headless opt-in: approves without prompting.

**Drift pinning (1 test)**
- `pinTools`: records tool hash.
- `checkDrift`: returns true when hash changed, false when stable.

**Display + danger (2 tests)**
- `describeEntry`: shows raw command/URL, never header/env secret values.
- `dangerFlags`: detects sudo, rm -rf, curl|sh, wget|sh patterns.

## Files Changed

- `src/mcp/consent.ts` (new, 176 lines) — Core consent store implementation.
- `tests/mcp/consent.test.ts` (new, 179 lines) — Test suite.
- `.gitignore` (modified) — Added `.mcp-approvals.json`.

**Commit:** `e9159ad` — "feat(mcp): consent-on-mount store with spec hashing + tool-definition pinning (Slice 15 Task 2)" on branch `slice-15-mcp-mounts`.

## Self-Review

- **TDD evidence**: Tests ran RED (module not found) before implementation, then GREEN (13/13) after. Both standalone run and full typecheck/lint verified clean.
- **Code quality**: 
  - `bun run typecheck` — clean, no output.
  - `bun run lint:file` — clean after Biome auto-fix (line-wrapping, import-order only; no logic change).
  - No `console.log` / `console.*` in `src/mcp/consent.ts`.
  - No new npm dependencies (only `node:crypto`, `node:fs`, `node:path`, `ai` type imports).
- **Brief compliance**: 
  - Code applied verbatim from brief (Step 3).
  - All function signatures match: `specHash`, `toolsHash`, `readApprovals`/`writeApprovals`, `describeEntry`, `dangerFlags`, `ConsentDeps`, `ensureConsent`, `pinTools`/`checkDrift`.
  - Atomic file I/O via temp+rename implemented correctly.
  - Non-TTY degradation (skip with warning, not hang) matches brief's "NEVER a hang" contract.
  - Raw config hashing (from `entry.raw` field) ensures secrets are NAMES-only, never VALUES.
- **Linting adjustment**: One template-string warning in test (`'Bearer ${T}'` → `` `Bearer \${T}` ``) to satisfy Biome rule. No behavioral change; test logic identical.
- **Docs**: Pre-commit `docs:check` hook passed (confirmed no living docs broken by adding files to already-documented `src/mcp/` subsystem). Per project hard-line rule, full docs refresh (architecture.md/README/ROADMAP/Artifact) deferred to **slice close** per usual pattern.

## Concerns

None. Implementation is clean, brief code applied verbatim with only formatter adjustments (line-wrapping per Biome rules), all 13 tests pass, typecheck clean, lint clean after template-string fix, and pre-commit docs-check passed.

---

## Security Review Fixes

**Review findings (Critical + 2 Important):** Addressed three issues in `src/mcp/consent.ts` and test coverage.

**Critical — toolsHash delimiter-injection collision:**
- **Issue:** Original code joined attacker-controlled fields with bare `|`: `` `${name}|${description}|${schema}` ``. Two distinct tool sets could hash identically if fields were crafted to exploit the delimiter (e.g., `{ search: {description: 'find|things'} }` vs `{ 'search|find': {description: 'things'} }`), defeating rug-pull detection.
- **Fix:** Restructured to per-tool JSON serialization: `JSON.stringify([name, description, schemaJson])`. JSON escaping makes delimiter injection impossible. Sorted the resulting strings, joined with `\n`, then sha256—same hash for any tool order.
- **Code change:** Lines 59–64 in `src/mcp/consent.ts`.

**Important 1 — expanded-value fallbacks in specHash/describeEntry:**
- **Issue:** Both functions used `raw.command ?? entry.command` / `raw.url ?? entry.url`, which would silently hash/display EXPANDED (possibly secret-bearing) values if `raw` were malformed.
- **Fix:** Removed fallbacks; now read strictly from `raw`. If required field is missing, throw `new Error(\`malformed raw config for MCP server "${entry.name}"\`)`. Mount layer's per-entry try/catch (next task) degrades it at the boundary.
- **Code changes:** Lines 23–24, 37–38 (specHash); lines 103–104, 109–110 (describeEntry).

**Important 2 — coverage gaps:**
- **Issue:** No test coverage for delimiter-injection rug-pull regression or tool-ordering idempotence. Corrupt store degradation not tested.
- **Fix:** Added to `tests/mcp/consent.test.ts`:
  - `describe('toolsHash hardening')` with two tests:
    - `is not collidable via delimiter injection (rug-pull regression)` — verifies `toolsHash({ search: {description: 'find|things'} })` ≠ `toolsHash({ 'search|find': {description: 'things'} })`.
    - `is independent of tool listing order` — verifies `toolsHash({alpha, beta})` = `toolsHash({beta, alpha})`.
  - In `approval store` describe block: `degrades a corrupt store file to {} (re-consent, never crash)` — writes invalid JSON to approval file, confirms `readApprovals()` returns empty object (no crash).
- Also fixed test fixture: `dangerFlags` test now includes `raw: { command: 'sudo', args: [...] }` to satisfy strict raw-field validation.

**Verification:**
- `bun test tests/mcp/consent.test.ts` → 16 pass, 0 fail, 27 expect() calls.
- `bun run typecheck` → clean.
- `bun run lint:file -- "src/mcp/consent.ts" "tests/mcp/consent.test.ts"` → clean (after Biome auto-format: line-wrapping only, no logic change).

**Commit:** `git add src/mcp/consent.ts tests/mcp/consent.test.ts .gitignore && git commit -m "fix(mcp): collision-proof toolsHash via JSON field separation + strict raw-only hashing/display (Slice 15 Task 2 review)"`
