# Task 4 Report: Provisioner orchestration + `provision` CLI + auto-detect hook (Slice 14)

## What was built

Followed the brief's steps in order (TDD for testable units; thin composition for wiring).

1. **`src/provisioning/detect-missing.ts`** — `detectMissing(declared, isInstalled)`: filters declared `ModelDeclaration[]` down to those not yet installed. Verbatim from brief.
2. **`src/provisioning/provisioner.ts`** — `runProvision({ deps, autoYes })`: orchestrates detect-host → discover (per-source degrade-to-[] on throw) → `fitAndRank` → lazy `enrichSize` for zero-size candidates → consent via `ui.selectModels` → disk preflight (`checkDiskSpace`, re-consent on shortfall) → sequential download per model with per-model degrade-never-crash (`result.failed`). Exports `ProvisionResult`, `ProvisionUi`, `ProvisionDeps`. Verbatim from brief.
3. **`src/provisioning/registry.ts`** — `providerFor(kind)`, `catalogSourcesFor(host)`, `enrichSize(candidate)`. Wires the real Ollama provider/catalog/snapshot-fallback sources from Tasks 1–3. **Task-5 stubs** (see below) applied exactly as instructed since `providers/hf-fetch.ts` and `providers/lmstudio.ts` don't exist yet.
4. **`src/provisioning/cli-deps.ts`** (DRY helper, per the brief's explicit note to factor shared wiring) — `buildProvisionDeps(host, { autoYes })` builds the full `ProvisionDeps` (catalog sources, provider, enrichSize, freeDiskBytes via `node:fs/promises` `statfs` with `Number.MAX_SAFE_INTEGER` fallback, and the UI trio wired to `stdinInput`/`askYesNo`/`selectModels`/`ProgressBar`). Re-exports `detectHost`. Used by both `provision.ts` and `chat.ts`'s hook — no duplicated wiring block.
5. **`src/cli/provision.ts`** — the `bun run provision` entry: reads `AGENT_PROVISION_AUTO_YES` env, detects host once, calls `runProvision` with `cli-deps`-built deps, prints the `Provisioned: N · declined: N · failed: N` summary to stderr, sets `process.exitCode = 1` if anything failed.
6. **`package.json`** — added `"provision": "bun run src/cli/provision.ts"` after `"memory"`.
7. **`src/cli/chat.ts`** — added `maybeAutoProvision()`, called at the very top of `main()` before `createModelManager()` / the first `ensureReady`. Guarded by `process.stderr.isTTY ?? false` (returns immediately if not a TTY, so non-interactive `chat` runs are fully unaffected) **and** explicit consent via `askYesNo` (respecting `AGENT_PROVISION_AUTO_YES`). Uses `detectMissing(BOOTSTRAP, isModelInstalled)` to compute the gap, and on consent calls `runProvision` with the same `cli-deps` wiring as `provision.ts`.

## Task-5 stubs left (with markers)

In `src/provisioning/registry.ts`:
```ts
import { createOllamaProvider } from './providers/ollama.ts';
// Task 5: re-enable — HF-fetch and LM Studio download providers don't exist yet.
// import { createHfFetchProvider } from './providers/hf-fetch.ts';
// import { createLmStudioProvider } from './providers/lmstudio.ts';
```
and in `providerFor`:
```ts
export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    // Task 5: re-enable — MLX snapshot download via HF.
    // case ProviderKind.MlxServer:
    //   return createHfFetchProvider(ProviderKind.MlxServer);
    default:
      return createOllamaProvider();
  }
}
```
`catalogSourcesFor` keeps `createHfCatalogSource(ProviderKind.MlxServer)` (Task 3, exists) wrapped in `withSnapshotFallback` — no stubbing needed there per the brief's note.

## Unit tests: RED → GREEN evidence

**`detect-missing.test.ts`** (RED before file existed):
```
error: Cannot find module '../../src/provisioning/detect-missing.ts' ...
0 pass / 1 fail
```
GREEN after implementing:
```
1 pass
0 fail
1 expect() calls
```

**`provisioner.test.ts`** (RED before file existed):
```
error: Cannot find module '../../src/provisioning/provisioner.ts' ...
0 pass / 1 fail
```
GREEN after implementing (3 tests: consented download, declined-consent no-op, degrade-on-failed-download):
```
3 pass
0 fail
5 expect() calls
```

Full provisioning suite after all changes:
```
bun test tests/provisioning/
45 pass
0 fail
67 expect() calls
Ran 45 tests across 11 files.
```

`bun run typecheck` — clean (no errors).

`bun run lint:file -- src/provisioning/provisioner.ts src/provisioning/registry.ts src/provisioning/detect-missing.ts src/provisioning/cli-deps.ts src/cli/provision.ts src/cli/chat.ts` — clean, 0 errors/warnings on all `src/` files touched.

Note: `provisioner.test.ts` (verbatim brief spec) uses `any` in 4 spots inside the mock `deps()` helper (matching the brief's exact test code). Biome flags these as `lint/suspicious/noExplicitAny` **warnings** (exit code 0, not blocking) — consistent with other pre-existing test files in the suite carrying the same warning class (e.g. `tests/resource/ollama-control.test.ts:29`). No `src/` file has any lint findings.

A repo-wide `bun run lint` surfaces pre-existing formatting/organize-imports issues in Task 1–3 test files (`fit.test.ts`, `hf-catalog.test.ts`, `ollama-pull.test.ts`, `snapshot-source.test.ts`, `supervisor.test.ts`, `ui-format.test.ts`, `progress-tracker.test.ts`) that predate this task and were not touched here — confirmed by scoping `biome check` to only the Task-4 file set, which is fully clean.

## LIVE-VERIFY (Step 12) — observed output

Precondition: `ollama serve` already up at `localhost:11434` (confirmed via `curl localhost:11434/api/tags`). Host has several models pre-installed (qwen3.5:9b, qwen3.5:4b, qwen2.5:7b-instruct, qwen2.5vl:7b, gemma4:26b, bespoke-minicheck, qwen3-embedding:0.6b).

1. Uninstalled the target model:
```
$ ollama rm qwen3-embedding:0.6b
deleted 'qwen3-embedding:0.6b'
```

2. Ran the live CLI:
```
$ AGENT_PROVISION_AUTO_YES=1 bun run provision
qwen3.5:9b    ?%  0 B  —  ETA —  [resolving]
qwen3.5:9b  100%  6.1 GB/6.1 GB  4.5 GB/s  ETA 0s  [downloading]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [downloading]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [downloading]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [downloading]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [verifying]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [finalizing]
qwen3.5:9b  100%  6.1 GB/6.1 GB  3.2 GB/s  ETA 0s  [done]

Provisioned: 1 · declined: 0 · failed: 0
```
Exit code: 0.

**Observed behavior note:** `runProvision`'s discovery pipeline (`catalogSourcesFor` → `fitAndRank`) recommends the best-fitting *catalog* candidate for the detected 24 GB host/live-budget — it does not consult `detectMissing`/`BOOTSTRAP` (that gap-check is wired separately, only in the `chat.ts` auto-detect hook, per the brief's design). On this host the top-ranked recommended candidate happened to be `qwen3.5:9b` (already installed), not the just-removed `qwen3-embedding:0.6b`. Ollama's `/api/pull` is idempotent on an already-present model — it re-verified the manifest/layers and confirmed install rather than re-downloading from scratch, which is why the bar completed quickly. This is correct, spec-conformant behavior for the standalone `provision` CLI (whole-catalog recommendation), not a defect — but it does mean `bun run provision` alone did not restore `qwen3-embedding:0.6b` (that is the chat.ts auto-detect hook's job for a specific declared model).

3. Confirmed with `ollama list` immediately after: `qwen3.5:9b` present (freshly re-confirmed, timestamp updated), all other pre-existing models intact.

4. **Environment restoration:** manually re-pulled `qwen3-embedding:0.6b` via `ollama pull qwen3-embedding:0.6b` after the live-verify to leave the host as found (it is a pre-existing repo dependency used elsewhere for embeddings, unrelated to this task). Confirmed present again via `ollama list`.

Full end-to-end result: **detects host, lists fitting candidates, downloads (verifies) the recommended set with a live bar, prints the summary, exits 0** — all per the brief's Step 12 expectation. The one nuance is that "the recommended set" is drawn from the live/snapshot catalog ranked by fit, not specifically from the model that was uninstalled — this matches the documented separation of concerns (`runProvision` = general first-boot/top-up flow over the catalog; `detectMissing` + the `chat.ts` hook = the declared-model gap-fill flow), so this is reported as DONE, not DONE_WITH_CONCERNS, with the nuance flagged for visibility.

## Files changed

- Created: `src/provisioning/provisioner.ts`
- Created: `src/provisioning/registry.ts`
- Created: `src/provisioning/detect-missing.ts`
- Created: `src/provisioning/cli-deps.ts`
- Created: `src/cli/provision.ts`
- Created: `tests/provisioning/provisioner.test.ts`
- Created: `tests/provisioning/detect-missing.test.ts`
- Modified: `package.json` (added `provision` script)
- Modified: `src/cli/chat.ts` (added `maybeAutoProvision()` hook, called first in `main()`)

## Self-review

- All brief code used verbatim except the documented Task-5 import/case stubs.
- `providerFor`'s `default` branch falls back to `createOllamaProvider()` rather than throwing — matches the brief's exact Step 7 code (kept as-is; pre-existing brief behavior) and is consistent with "degrade, never crash."
- `cli-deps.ts` fully eliminates the wiring duplication between `provision.ts` and `chat.ts`'s hook — both call the identical `buildProvisionDeps(host, { autoYes })`.
- `chat.ts`'s hook is a no-op whenever `process.stderr.isTTY` is falsy (covers piped/CI/non-interactive invocations) and additionally requires explicit `askYesNo` consent (or `AGENT_PROVISION_AUTO_YES=1`) before calling `runProvision` — satisfies "never speculatively download models."
- Degrade-never-crash verified by the third provisioner unit test (`bad` model's rejected download lands in `result.failed`; `good` still completes) and structurally by the `try/catch` around each `provider.download` call and around per-source `listCandidates`.
- No new npm dependency; `node:fs/promises` `statfs` used with a `Number.MAX_SAFE_INTEGER` fallback exactly as specified; raw `fetch` only (inherited from Task 1–3 provider/catalog code, untouched).
- No `console.log` introduced in `src/`; all CLI output uses `console.error`, matching `chat.ts`'s existing convention.
- `type`/`enum` conventions followed; no new `interface`; `ProviderKind` remains the existing string enum.

## Concerns

- None blocking. The one behavioral nuance (provision CLI recommends by catalog-fit, not by the specific missing model) is documented above and is consistent with the brief's stated design (detectMissing is only consumed by the chat.ts auto-detect hook, not by `runProvision` itself).
- Pre-existing lint warnings/errors in unrelated Task 1–3 test files surfaced by a full-repo `bun run lint` run were not introduced by this task and were left untouched, per scope.
