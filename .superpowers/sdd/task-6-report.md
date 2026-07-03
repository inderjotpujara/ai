# Task 6 Report (Slice 18) — hf-fetch single-file atomic write + sha256 (HfGguf)

*(Reuses the per-slice `task-6-*` filename; previous content was the Slice-17
Task-6 report. Overwritten with the current Slice-18 Task-6 report.)*

**Status:** DONE
**Branch:** slice-18-debt-wrapup-mlx
**Commit:** fbf49fd — feat(provisioning): hf-fetch writes single GGUF files atomically with sha256

## What changed
- `src/provisioning/providers/hf-fetch.ts` — added a private `downloadFile(url, destPath, {onProgress, signal, tracker, expectedOid?})`:
  1. `mkdir(dirname(destPath), {recursive})`, opens a write stream to `destPath + '.part'`;
  2. read loop WRITES each chunk (`writeChunk` helper wraps `stream.write` in a Promise), accumulates `done`, emits `Downloading`;
  3. on loop end: `endStream`, emit `Verifying`, `const hash = await (deps.sha256 ?? sha256File)(partPath)`; if `expectedOid` set and `hash !== expectedOid` → throw `ProviderError`;
  4. emit `Finalizing`, atomic `rename(partPath, destPath)`, emit `Done`;
  5. entire body wrapped in `try/finally` that `unlink`s a surviving `.part` (abort/error leaves no partial file).
  - `HfGguf` path (`modelRef = repo::file`) calls `downloadFile(url, join(destDir, file), …)`. The `deps.sha256` injection seam is preserved (defaults to real `sha256File`); `expectedOid` stays optional (Task 8 wires real oids, Task 7 tests the mismatch path). HfSnapshot (no `::file`) keeps the prior byte-counting behavior.
- **DRY (logged Minor):** extracted the duplicated destDir env-fallback into `resolveDestDir()` at new `src/provisioning/dest-dir.ts` (`HF_HOME ?? OLLAMA_MODELS ?? cwd/model-images`, behavior identical). Now called from `src/provisioning/provisioner.ts` and `src/discovery/discover.ts` (both inline copies removed).

## TDD evidence
- **RED:** added `HfGguf: writes the file to destDir atomically and reaches Done` to `tests/provisioning/hf-fetch.test.ts` (uses existing `streamingResponse()`; asserts file exists at `<destDir>/model.gguf`, byteLength 2000, no `.part` remains, phases include `Finalizing`, ends `Done`).
  - `bun run test:file -- tests/provisioning/hf-fetch.test.ts` → **1 pass / 1 fail** — `expect(existsSync(out)).toBe(true)` received `false` (no bytes written yet). Failing for the right reason.
- **GREEN:** after implementing `downloadFile`:
  - `bun run test:file -- tests/provisioning/hf-fetch.test.ts` → **2 pass / 0 fail / 7 expect() calls**.

## Verification
- `bun run typecheck` → clean (`tsc --noEmit`, 0 errors).
- `bun run lint:file` (all 5 touched files) → clean (fixed one import-ordering: `import type {WriteStream}` placed before the value import).
- `bun run docs:check` → pass (living docs present + linked; every subsystem documented).
- `bun test` (full suite) → **479 pass / 2 skip / 0 fail**, 1016 expect() calls, 481 tests across 139 files. Build stays green.

## Concerns
- None blocking. `expectedOid` intentionally unused for now (no real oids until Task 8); the mismatch-throw path is covered by the injection seam and will be exercised by Task 7.
- Slice-level `architecture.md`/README/ROADMAP/ledger updates remain the slice-landing responsibility, not this mid-slice task.

## Security fix (path traversal) — HIGH finding, follow-up

A HIGH path-traversal finding was raised against the single-file write: the
destination was built as `join(destDir, file)` where `file` comes from the
untrusted `modelRef` (`repo::file`). A ref like `org/repo::../../evil.gguf` or
`org/repo::/etc/evil` would write OUTSIDE `destDir`. Task 9's HF-tree snapshot
`path` entries would join the same way — same risk class.

### Fix
- `src/provisioning/providers/hf-fetch.ts` — added an EXPORTED `safeJoin(destDir, relPath)`
  helper (so Task 9's snapshot path-join reuses it). It rejects NUL bytes,
  absolute paths, and any `..` traversal segment, then defence-in-depth verifies
  the resolved path stays within `resolve(destDir)` (`=== base` or `startsWith(base + sep)`),
  throwing `ProviderError` otherwise. Uses `node:path` (`isAbsolute`/`resolve`/`sep`).
- Replaced the single `join(destDir, file)` call with `safeJoin(destDir, file)`.
  No other behavior changed. Degrade-never-crash preserved: a bad path throws
  `ProviderError`, which the provisioner's per-model `try/catch` (provisioner.ts
  step 6) already funnels into `result.failed` — verified that catch exists.

### TDD evidence
- **RED:** added two cases to `tests/provisioning/hf-fetch.test.ts` — a `modelRef`
  whose file component is `../../evil.gguf`, and a second with absolute `/etc/evil`
  — each asserting `provider.download(...)` rejects AND no file lands outside the
  temp destDir (parent dirs + `/etc/evil` checked).
  - `bun run test:file -- tests/provisioning/hf-fetch.test.ts` → **2 pass / 2 fail** —
    both new cases: "Expected promise that rejects / Received promise that resolved"
    (the traversal write succeeded pre-guard; a stray `evil.gguf` was written into
    tmpdir's parent, confirming the vulnerability). Failing for the right reason.
- **GREEN:** after adding `safeJoin`:
  - `bun run test:file -- tests/provisioning/hf-fetch.test.ts` → **4 pass / 0 fail / 12 expect() calls**.

### Verification
- `bun run typecheck` → clean (`tsc --noEmit`, 0 errors).
- `bun test` (full suite) → **481 pass / 2 skip / 0 fail**, 1021 expect() calls, 483 tests across 139 files. Green (+2 tests vs the 479 baseline).
