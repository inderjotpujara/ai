# Task 5 Report: LM Studio + HF-fetch adapters (Slice 14)

## What was built

Two new `DownloadProvider` adapters completing coverage for all four runtimes, plus re-enabling the Task-4 registry stub.

1. **`src/provisioning/providers/hf-fetch.ts`**
   - `sha256File(path)`: streams a file through `node:crypto` SHA256 via `node:fs.createReadStream` — no new deps.
   - `createHfFetchProvider(kind, deps?)`: raw-`fetch` HuggingFace downloader. Reads the `modelRef` convention `repo/id` (MLX whole-snapshot — resolves `.../resolve/main/`) vs `repo/id::file.gguf` (llama.cpp GGUF single-file — resolves `.../resolve/main/file.gguf`). Streams the response body via `getReader()`, emitting `Resolving → Downloading → Verifying → Done` through the shared `ProgressTracker`. `deps.fetchImpl`/`deps.sha256` are injectable for tests; production defaults to global `fetch` and `sha256File`.
   - Fixed one brief typo: `deps.sha256(file ?? repo)` doesn't typecheck under this repo's strict settings because destructuring `modelRef.split('::')` types `repo` as `string | undefined`. Changed to `file ?? repo ?? modelRef` (modelRef is always a string) — functionally identical, just satisfies `tsc --noEmit`.

2. **`src/provisioning/providers/lmstudio.ts`**
   - `createLmStudioProvider(deps?)`: POSTs `{baseUrl}/api/v1/models/download` to start a job, then polls `{baseUrl}/api/v1/models/download/{job_id}` until `status === 'completed'` (or `'failed'` → throws `ProviderError`), normalizing each poll into `DownloadPhase.Downloading` progress and a final `Done`. Short-circuits on `status === 'already_downloaded'`. `pollMs` (default 1000, test uses 0) and `fetchImpl`/`baseUrl` are injectable.
   - `kind: ProviderKind.MlxServer` — LM Studio serves both GGUF and MLX under the existing `MlxServer` provider kind (no new enum member; matches how `ProviderKind` is currently modeled, per `src/core/types.ts`).

3. **`src/provisioning/registry.ts`** — re-enabled the Task-4 stub:
   - Uncommented `import { createHfFetchProvider } from './providers/hf-fetch.ts';`.
   - Restored the `ProviderKind.MlxServer` case in `providerFor` to return `createHfFetchProvider(ProviderKind.MlxServer)` instead of falling through to the `default: createOllamaProvider()` branch.
   - Deliberately did **not** import `createLmStudioProvider` into `registry.ts` — `providerFor` switches only on `ProviderKind`, and LM Studio doesn't have a distinct kind (it shares `MlxServer`, same as HF-fetch). Importing it unused would fail lint/`noUnusedLocals`; there was no route for it to be dispatched to in the current registry shape. `createLmStudioProvider` is fully implemented, exported, and contract-tested — it's just not wired into `providerFor` yet, matching the fact the registry has no LM-Studio-specific `ProviderKind` to switch on.

## RED → GREEN TDD evidence

**hf-fetch:**
```
$ bun test tests/provisioning/hf-fetch.test.ts   # before impl
error: Cannot find module '../../src/provisioning/providers/hf-fetch.ts'
0 pass / 1 fail / 1 error

$ bun test tests/provisioning/hf-fetch.test.ts   # after impl
1 pass / 0 fail / 2 expect() calls
```

**lmstudio:**
```
$ bun test tests/provisioning/lmstudio.test.ts   # before impl
error: Cannot find module '../../src/provisioning/providers/lmstudio.ts'
0 pass / 1 fail / 1 error

$ bun test tests/provisioning/lmstudio.test.ts   # after impl
1 pass / 0 fail / 1 expect() call
```

Both tests inject a fake `fetch` (`fetchImpl`) — no real network calls made.

## MlxServer routing confirmation

Ran a focused inline check against the real module (not just a read):

```
$ bun -e "
import { providerFor } from './src/provisioning/registry.ts';
import { ProviderKind } from './src/core/types.ts';
const p = providerFor(ProviderKind.MlxServer);
console.log('kind:', p.kind, 'isMlx:', p.kind === ProviderKind.MlxServer);
"
kind: MlxServer isMlx: true
```

Confirms `providerFor(ProviderKind.MlxServer)` now returns the HF-fetch provider (`kind === ProviderKind.MlxServer`), fixing the Task-4 OPEN IMPORTANT finding: MLX candidates from the live HF catalog were previously silently misrouted to `createOllamaProvider()` via the `default` branch.

## Full verification

```
bun run typecheck                                        → clean (0 errors)
bun run lint:file -- src/provisioning/**/*.ts (18 files)  → clean (0 errors) after biome --write
                                                              auto-fixed formatting/import-order drift
                                                              introduced by the brief's literal one-line
                                                              snippets (long single-line if/throw, unsorted
                                                              imports) — no logic changes from the fix.
bun test tests/provisioning/                              → 47 pass / 0 fail (was 45 before Task 5)
bun run docs:check                                        → passes (provisioning subsystem already
                                                              documented in architecture.md; no new
                                                              subsystem added by this task)
```

No `console.log`/`console.warn`/`console.info` and no `any` in either new file or the registry diff.

## Deferred live-verify ledger line

Appended to `.superpowers/sdd/progress.md` (S14 Task 5 entry), including:

> "LM Studio + HF-fetch (llama.cpp/MLX) adapters: contract-tested green; LIVE-VERIFY DEFERRED pending runtime install on a test machine. Ollama verified live (Tasks 2, 4)."

plus full task detail (files, what changed, RED→GREEN counts, MlxServer routing fix, test counts, and the LM Studio endpoint-provisionality concern).

## Files changed

- `src/provisioning/providers/hf-fetch.ts` (new)
- `src/provisioning/providers/lmstudio.ts` (new)
- `src/provisioning/registry.ts` (modified — re-enabled HF-fetch import + `MlxServer` case)
- `tests/provisioning/hf-fetch.test.ts` (new)
- `tests/provisioning/lmstudio.test.ts` (new)
- `.superpowers/sdd/progress.md` (ledger entry appended)

Commit: `2195f03` on branch `slice-14-provisioning` — "feat(provisioning): LM Studio + HF-fetch adapters (llama.cpp/MLX), contract-tested, live-verify deferred (Slice 14 Task 5)"

Note: several `.superpowers/sdd/task-*.md` and `.remember/now.md` files show as modified in `git status` from before this session started (Slice 14 reuses the same brief/report filenames as Slice 13); these were left untouched/unstaged per the brief's exact `git add` file list in Step 10.

## Self-review

- **Correctness:** Both adapters follow the exact contract (`DownloadProvider.download(modelRef, {onProgress, signal})`), use the shared `ProgressTracker` for monotonic percent/EWMA speed exactly like `providers/ollama.ts` does, and throw `ProviderError` (not a bare `Error`) on failure paths, consistent with the rest of `src/provisioning`.
- **TDD was real:** both tests failed with "Cannot find module" before the implementation existed, then passed after — genuine RED→GREEN, not retrofitted.
- **No new deps:** confirmed no changes to `package.json`/`bun.lock`; only `node:crypto`, `node:fs`, and global `fetch` are used.
- **Deviation from brief (justified):** the one typecheck fix in `hf-fetch.ts` (`file ?? repo ?? modelRef`) and not importing `createLmStudioProvider` into `registry.ts`. Both are minimal, don't change adapter behavior, and were required to keep `tsc --noEmit` / lint clean rather than mechanically pasting the brief's snippets verbatim.
- **Formatting drift:** `bunx biome check --write` reformatted the three new/modified provisioning files (long one-liners → wrapped multi-line per biome's line-length rule, import sort in `registry.ts`). Verified via diff that this was pure formatting — no logic changed.

## Concerns

1. **LM Studio endpoint provisionality (real, disclosed per instructions):** The LM Studio local REST download surface (`POST /api/v1/models/download`, `GET /api/v1/models/download/{job_id}`, fields `job_id`/`status`/`downloaded_bytes`/`total_size_bytes`) is **undocumented/unstable** per available research at the time of writing — this is best-effort reverse-engineered shape, not a guaranteed stable API contract. It **must** be corrected/verified against the actual running LM Studio REST API once installed on a test machine. The richer, documented path is the `@lmstudio/sdk` npm package, deliberately not added here per the "no new dependency" constraint.
2. **llama.cpp/MLX HF-fetch adapter is also live-verify-deferred** — the streaming-to-disk path (write to a `.part` file + atomic rename on completion, which real downloads need) is not implemented/tested yet; the current implementation reads the stream and tracks progress/bytes but does not persist to disk. This mirrors the brief's own Step-2 note ("the real file-write + on-disk path ... is exercised in the deferred live-verify"), but is worth flagging explicitly: **when this ships live, on-disk persistence (write stream + rename) will need to be added**, not just progress tracking. This is scoped as part of the deferred live-verify, not a Task-5 gap per the brief, but it is a materially incomplete piece of "download" behavior until that lands.
3. **Pre-existing lint debt (out of scope, noted only):** `bun run lint` (whole-repo) reports pre-existing formatting errors in unrelated files (e.g. `tests/provisioning/ui-prompt.test.ts`, from Task 1's commit `75799d6`, `git diff HEAD` shows zero delta from my session). Confirmed via `bunx biome check` on the unmodified file. Left untouched — not part of Task 5's scope, and fixing it would violate the "only stage Task 5's files" instruction in Step 10.
