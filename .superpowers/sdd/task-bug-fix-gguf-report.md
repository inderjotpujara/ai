# Bug Fix Report: GGUF Shard-Aware Quant Sizing + Pre-Pull Failure Reporting

## Commit

`454ac94` — fix(discovery): shard-aware quant sizing + footprint-consistent fit + pre-pull failure reporting

## Changes per File

### `src/discovery/huggingface-gguf.ts` (Fix A — core fix)

Rewrote `candidateFor` with the following changes:

- **Dropped** `QUANT_RE` (which required the quant immediately before `.gguf`). Replaced with `QUANT_TOKEN_RE = /\b(IQ\d\w*|Q\d[\w_]*)\b/i`, which matches a quant token from anywhere in a filename. This handles both single-file and sharded (`-00001-of-00003.gguf`) naming patterns.
- **Added** `FULL_PRECISION = new Set(['F16', 'F32', 'FP16', 'BF16'])` exclusion so full-precision files are never selected.
- **Added** mmproj/projector filename exclusion guard.
- **Added** shard grouping: walks the tree and accumulates `e.lfs?.size ?? e.size` per quant label into a `Map<string, number>`. Shards of the same quant are summed.
- **Changed** footprint computation to mirror the Model Manager exactly: `weightsBytes(summedBytes/1e9/bpw, bpw) + kvCacheBytes(MIN_CTX, DEFAULT_KV)` (imports from `../resource/footprint.ts` and `../resource/model-manager.ts`). A local constant `DEFAULT_KV = 131072` matches `DEFAULT_KV_PER_TOKEN` in model-manager.
- **Changed** candidate selection: among quants whose footprint fits the budget, picks the one with the largest `summedBytes` (instead of `pickBestQuantThatFits` which compared file size directly to budget).
- **Changed** `fileSizeBytes` to be `summedBytes` (the real on-disk total across all shards).
- Removed `pickBestQuantThatFits` import (no longer used); kept `bytesPerWeightForQuant`.

**How the new logic works**: For each GGUF repo, all files are scanned, shards are summed by quant label, full-precision and mmproj files are skipped, then for each remaining quant tier the footprint is computed the same way the Model Manager does before loading. Only tiers that fit the budget are eligible, and the one with the largest total on-disk size wins (most capable model that fits).

### `src/discovery/quant.ts`

No changes — existing exports (`QuantFile`, `bytesPerWeightForQuant`, `pickBestQuantThatFits`) are unchanged and quant.test.ts remains green.

### `src/discovery/discover.ts` (Fix B)

- Added `pullFailed: { model: string; reason: string }[]` field to `DiscoverResult`.
- In `runDiscovery`, changed the pull loop's `catch` block from `/* report, don't fail */` to `pullFailed.push({ model: c.model, reason: (err as Error).message ?? String(err) })`.
- Returns `pullFailed` in the result object.

### `src/cli/discover.ts` (Fix B)

After printing the summary line, added a loop that prints one `failed-to-pull: <model>: <reason>` line per failure entry (only if any).

### `tests/discovery/huggingface-gguf.test.ts`

Added two new tests:

1. **shard-aware: sums multi-shard Q4_K_M, excludes F16 and mmproj** — fixture with 3 Q4_K_M shards (1.5GB each, total 4.5GB), a F16 file, and an mmproj file. Budget 16GB. Asserts: `cands.length === 1`, `quant === 'Q4_K_M'`, `fileSizeBytes === 4_500_000_000`, correct model string.
2. **budget-too-small: no candidate returned when footprint exceeds budget** — same fixture, budget 1GB. Asserts: `cands.length === 0`.

The existing test (`builds a fitting tool-capable GGUF candidate`) passes unchanged.

### `tests/discovery/discover.test.ts`

Added one new test:

- **failing pullTop populates pullFailed** — two candidates, `prePullCount: 2`, `pullTop` succeeds for one and throws for the other. Asserts `out.pulled` contains the good model and not the bad one, `out.pullFailed` has one entry with the expected model and a non-empty reason string.

## Verification Results

```
bun run typecheck   → clean (0 errors)
bunx biome check --write .  → fixed 1 file (import order), 0 lint errors (1 informational biome.json deprecation note, pre-existing)
bun run lint        → exit 0, 0 warnings
bun test            → 133 pass / 1 skip / 0 fail (134 tests across 48 files)
```
