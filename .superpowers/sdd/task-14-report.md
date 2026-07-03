# Task 14 report: wire dead provisioning telemetry attrs + truthful `snapshotFallback`

## Summary

`PROVISION_RUNTIME` and `PROVISION_DEFERRED_VERIFY` were declared in the `ATTR`
registry but never set on any span. `snapshotFallback` was hardcoded `false`
from `runProvision` regardless of whether the committed-snapshot catalog
actually served the discovered candidates. All three are now wired to real
signals — no new hardcodes.

## Changes

### `src/telemetry/spans.ts`
- Documented `PROVISION_RUNTIME`'s intent (the inference `RuntimeKind`
  backing the provisioned models — distinct from `Candidate.provider`, the
  download `ProviderKind`).
- `ProvisionSpanInfo` gained `runtimes: string[]`.
- `withProvisionSpan` now sets `ATTR.PROVISION_RUNTIME` to that array (OTel
  span attributes support array values; a run can select models across more
  than one runtime, so a single scalar would have been misleading).

### `src/discovery/catalog-source.ts`
- `CatalogSource` gained an optional `usedSnapshotFallback?(): boolean` —
  true when the source's most recent `listCandidates()` call served from the
  committed snapshot rather than a live source. Optional so plain sources
  and existing test doubles keep compiling unchanged (absent = "never falls
  back").

### `src/provisioning/catalog/snapshot-source.ts`
- `withSnapshotFallback` now tracks whether its last `listCandidates()` call
  used the live source or the snapshot fallback (empty-result or thrown
  error → fallback) and exposes it via `usedSnapshotFallback()`.

### `src/provisioning/provisioner.ts`
- `runProvision` now captures the filtered `applicableSources` once, and
  after discovery computes `snapshotFallback = applicableSources.some(s =>
  s.usedSnapshotFallback?.() ?? false)` — a truthful, per-run value instead
  of the old hardcoded `false`.
- Computes `runtimes = [...new Set(selected.map(c => c.runtime))]` before
  entering `withProvisionSpan` and passes both into `ProvisionSpanInfo`.
- The download loop now captures each provider's `DownloadOutcome` and sets
  `ATTR.PROVISION_DEFERRED_VERIFY = true` if ANY download in the batch
  recorded a hash without verifying it against a known source oid.

### `src/provisioning/types.ts`
- Added `DownloadOutcome = { deferredVerify: boolean }`, with a doc comment
  spelling out the approximation: only the HF providers currently emit a
  meaningful signal (a missing/failed tree oid); Ollama/LM Studio verify
  integrity inside their own daemons, so providers that don't return an
  outcome are treated as `false` — an honest "no signal", not a claim they
  verified.
- `DownloadProvider.download`'s return type widened to
  `Promise<DownloadOutcome | void>` (kept `void`, not `undefined`, via a
  documented `biome-ignore`, so existing no-return provider implementations
  stay assignable without every provider needing an explicit `return
  undefined`).

### `src/provisioning/providers/hf-fetch.ts`
- Single-file (`HfGguf`) path: returns `{ deferredVerify: expectedOid ===
  undefined }` — true exactly when `resolveExpectedOid` degraded (tree
  lookup failed or the file had no oid), matching the existing
  "compute-and-record, no gate" comment already in that function.
- Multi-file (`HfSnapshot`) path: returns `{ deferredVerify: files.some(f =>
  f.oid === undefined) }` — the whole snapshot download is flagged deferred
  if any one file in the tree lacked an oid.
- `ollama.ts` / `lmstudio.ts` untouched — they implicitly return `void`,
  which the provisioner treats as `deferredVerify: false` (documented
  approximation above).

## Tests (TDD)

- `tests/provisioning/hf-fetch.test.ts`: extended three existing tests to
  assert the new return value —
  - HfSnapshot multi-file, no oids on any tree entry -> `{ deferredVerify:
    true }`.
  - HfGguf, tree lookup throws (degrade path) -> `{ deferredVerify: true }`.
  - HfGguf, tree oid present and matches the downloaded sha256 -> `{
    deferredVerify: false }`.
- `tests/provisioning/eval.test.ts` (span-level, via the existing
  `registerTestProvider`/`InMemorySpanExporter` harness):
  - Extended the existing "emits ... attrs" test to assert
    `PROVISION_RUNTIME` equals `[RuntimeKind.Ollama]` and
    `PROVISION_DEFERRED_VERIFY` is `false` for a plain Ollama-only run
    (regression guard for the "unset attribute" dead-code bug).
  - New test: a catalog source whose `usedSnapshotFallback()` returns `true`
    -> the span's `PROVISION_SNAPSHOT_FALLBACK` is `true` (would fail against
    the old hardcoded `false`; this is the non-vacuous case the task asked
    for).
  - New test: a download provider that returns `{ deferredVerify: true }` ->
    the span's `PROVISION_DEFERRED_VERIFY` is `true`.

All new assertions were run RED first (against the pre-fix code, confirmed
they failed for the intended reason — dead attrs / hardcoded `false`) then
GREEN after the implementation.

## Verify (inline only, as instructed)

- `bun run typecheck` -> 0 errors.
- `bun run lint:file -- src/telemetry/spans.ts src/provisioning/provisioner.ts src/provisioning/types.ts src/provisioning/providers/hf-fetch.ts src/provisioning/catalog/snapshot-source.ts src/discovery/catalog-source.ts tests/provisioning/eval.test.ts tests/provisioning/hf-fetch.test.ts` -> clean (one `noConfusingVoidType` warning fixed by moving the `biome-ignore` comment to directly precede the flagged token).
- `bun run test:file -- "tests/provisioning/eval.test.ts" "tests/provisioning/hf-fetch.test.ts" "tests/provisioning/provisioner.test.ts"` -> 26 pass, 0 fail, 76 expect() calls. (Did NOT run the full `bun test` suite per instructions.)

## Concerns / honest limitations

- `PROVISION_RUNTIME` is emitted as an array (`string[]`), not a single
  scalar, because a provisioning run can select models spanning more than
  one `RuntimeKind` in one batch. This is a span-attribute-array (a valid
  OTel shape) rather than a single value — flagging in case a consumer
  downstream expects a scalar.
- `PROVISION_DEFERRED_VERIFY` for Ollama/LM Studio downloads is a documented
  approximation (`false`, meaning "no signal", not "verified"). Getting a
  true signal from those daemons would require deeper daemon-side
  instrumentation, out of scope for this task per the "best honest
  approximation, document the limitation" guidance.
- `usedSnapshotFallback()` reflects only the *most recent* `listCandidates()`
  call on that source — correct for `runProvision`'s single discovery pass,
  but would go stale if a `CatalogSource` were reused across multiple
  discovery passes without re-listing in between.
