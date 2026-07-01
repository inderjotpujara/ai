# Bug Fix: GGUF Shard-Aware Quant Sizing + Pre-Pull Failure Reporting

## Context

Branch: `slice-6-model-discovery` at `/Users/inderjotsingh/ai`
Base commit (before this task): `c3e5be3`
Report file: `/Users/inderjotsingh/ai/.superpowers/sdd/task-bug-fix-gguf-report.md`

This is a single-task bug fix with two parts (Fix A and Fix B) plus tests. The
codebase uses TypeScript + Bun, `.ts` import extensions, `type` over `interface`,
early returns, and `tsconfig` has `noUncheckedIndexedAccess` (no `!` assertions,
guard all array accesses). Use `bun`, never `npm`. Use `bunx biome check --write .`
to fix lint/formatting. The `enum` style is used for finite named value sets.

## Bug A: `src/discovery/huggingface-gguf.ts` — Phantom candidates from single-file matching

### What's wrong

`candidateFor` matched a quant using `QUANT_RE` (which requires the quant
immediately before `.gguf`). It used ONE file's `sizeBytes` for the budget check,
while the `footprint` used `gguf.total` (logical param count) × bpw. For
multi-shard / MoE repos these diverge: a 1.2GB `F16`-named shard matched while
the real model is ~60GB. Also: sharded GGUFs (`...-00001-of-00003.gguf`) didn't
match the old `QUANT_RE` at all.

### Fix A — rewrite `candidateFor` in `src/discovery/huggingface-gguf.ts`

1. **Extract quant from ANY position in the filename** (not just before `.gguf`).
   Match a known quant token ANYWHERE in the filename (case-insensitive). Use a
   regex over tokens like `IQ\d\w*`, `Q\d[\w_]*`, `Q\d_K(_[SML])?`. Drop the old
   `QUANT_RE`.

2. **Exclude full-precision files** (F16, F32, FP16, BF16 — any file whose
   extracted quant is one of these). Skip files whose name contains `mmproj` or
   `projector`.

3. **Group shards by quant label and SUM their sizes** (use `lfs.size ?? size`).
   This handles `-00001-of-0000N` patterns.

4. **Compute footprint the SAME way the Model Manager does**:
   - `bpw = bytesPerWeightForQuant(quant)`
   - `approxParamsBillions = summedBytes / 1e9 / bpw`
   - `footprint = weightsBytes(approxParamsBillions, bpw) + kvCacheBytes(MIN_CTX, DEFAULT_KV)`
   - Import `weightsBytes`, `kvCacheBytes` from `../resource/footprint.ts`
   - Import `MIN_CTX` from `../resource/model-manager.ts`
   - Use a local constant `DEFAULT_KV = 131072` (same as `DEFAULT_KV_PER_TOKEN` in manager)

5. **Choose the best quant**: among quants whose `footprint` fits `budgetBytes`,
   sort surviving quants by `summedBytes` desc and take the first. "Fits" means
   `footprint <= budgetBytes`.

6. **Build the Candidate** from the chosen quant:
   - `model: hf.co/<repo>:<quant>`
   - `fileSizeBytes = summedBytes` (the actual on-disk size, not a single shard)
   - `footprint: { approxParamsBillions: summedBytes/1e9/bpw, bytesPerWeight: bpw }`
   - **Stop using `gguf.total` for sizing** — keep `gguf.chat_template` for tool
     detection and `gguf.context_length` for `maxContext`.

7. If no quant tier fits (all footprints exceed budget), return `undefined`.

### Key interfaces (do not break)

```ts
// src/discovery/quant.ts — keep these exports unchanged
export type QuantFile = { quant: string; sizeBytes: number };
export function bytesPerWeightForQuant(quant: string): number { ... }
export function pickBestQuantThatFits(files: QuantFile[], budgetBytes: number): QuantFile | undefined { ... }
```

The shard-grouping + footprint-based selection REPLACES what was previously done
via `pickBestQuantThatFits`. You may add a helper to `quant.ts` if useful (e.g.
`groupAndSumShards(files: QuantFile[]): Map<string, number>`) but do NOT change
the existing exports or their behaviour (quant.test.ts tests them).

### Full-precision quant labels to exclude

F16, F32, FP16, BF16 (case-insensitive).

## Bug B: `src/discovery/discover.ts` + `src/cli/discover.ts` — Silent pre-pull failures

### What's wrong

When a `pullTop` call throws, it is silently dropped in the `catch {}` block.
The caller and the CLI never know which models failed to pre-pull.

### Fix B

1. **Add `pullFailed: { model: string; reason: string }[]` to `DiscoverResult`**
   in `src/discovery/discover.ts`.

2. In `runDiscovery`, in the pull loop's `catch` block, push to `pullFailed`:
   ```ts
   pullFailed.push({ model: c.model, reason: (err as Error).message ?? String(err) });
   ```
   Keep the catch (don't re-throw). Return `pullFailed` in the result.

3. **In `src/cli/discover.ts`**, after printing the summary line, also print any
   failures:
   ```
   Pre-pulled: <model, ...> or none
   failed-to-pull: <model>: <reason>   // one line per failure, only if any
   ```

## Tests

### `tests/discovery/huggingface-gguf.test.ts` — extend (do not break existing test)

Add:

**Test 1 — shard-aware multi-shard Q4_K_M, F16 excluded, mmproj excluded**

Fixture tree for repo `bartowski/big-model-GGUF`:
- `big-model-Q4_K_M-00001-of-00003.gguf` — lfs.size=1_500_000_000
- `big-model-Q4_K_M-00002-of-00003.gguf` — lfs.size=1_500_000_000
- `big-model-Q4_K_M-00003-of-00003.gguf` — lfs.size=1_500_000_000 (total: 4_500_000_000)
- `big-model-F16.gguf` — size=1_200_000_000 (should be excluded)
- `mmproj-big-model-F16.gguf` — size=500_000_000 (should be excluded — mmproj)

Info response: `{ gguf: { chat_template: 'tool_call', context_length: 16384 } }` (no `total` field)

Budget: 16e9 bytes (generous, so Q4_K_M fits).

Assert:
- `cands.length === 1`
- `cand.quant === 'Q4_K_M'`
- `cand.fileSizeBytes ≈ 4_500_000_000` (summed shards)
- `cand.model === 'hf.co/bartowski/big-model-GGUF:Q4_K_M'`
- F16 was NOT chosen (i.e., quant is Q4_K_M, not F16)

**Test 2 — budget-too-small: no candidate returned**

Same repo, but budget=1e9 (too small for any quant whose footprint ≈ summedBytes×1.2).

Assert: `cands.length === 0` (no candidate for this repo).

The existing test (`builds a fitting tool-capable GGUF candidate`) must still pass
unchanged — it uses a single `Q4_K_M` file with no shards and the result is still a
valid candidate.

### `tests/discovery/discover.test.ts` — extend

Add a test: **failing `pullTop` populates `pullFailed`**

Use the same helper pattern as the existing discover test. Pass a `pullTop` that
rejects for one model. Assert:
- `out.pulled` does NOT include the failed model
- `out.pullFailed` has one entry with the expected model and a non-empty reason string

### `tests/discovery/quant.test.ts`

Must remain green — do NOT modify `bytesPerWeightForQuant` or
`pickBestQuantThatFits` signatures or behaviour.

## Verification steps (run these; report all counts)

```sh
bun run typecheck        # must be clean (0 errors)
bunx biome check --write .  # fix formatting first
bun run lint             # exit 0, 0 warnings
bun test                 # full suite green; report pass/skip/fail counts
```

## Commit

After tests pass and lint is clean, commit with:
```
git add -A && git commit -m "fix(discovery): shard-aware quant sizing + footprint-consistent fit + pre-pull failure reporting"
```

## Report file

Write the full report to `/Users/inderjotsingh/ai/.superpowers/sdd/task-bug-fix-gguf-report.md`.
Include: what changed in each file, the verify results (typecheck/lint/test counts), commit hash,
how chosen-quant + footprint now work (2-3 sentences).

Then return only: status (DONE/BLOCKED), commit hash, one-line test summary, and any concerns.
