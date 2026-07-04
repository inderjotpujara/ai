# Slice 18 — Debt wrap-up + MLX completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discharge all dischargeable-now deferred debt through Slice 17 in one slice, centered on completing MLX support (real disk download + inference runtime) and untangling the overloaded `ProviderKind`.

**Architecture:** Split the single `ProviderKind` enum into a download-side `ProviderKind` (`Ollama | HfGguf | HfSnapshot | LmStudio`) and an inference-side `RuntimeKind` (`Ollama | MlxServer | LmStudio`); a `ModelDeclaration` carries `runtime: RuntimeKind`, a `Candidate` carries `provider: ProviderKind`, and `downloadKindFor()` maps between them at discovery. Make `hf-fetch` persist bytes atomically with HF-LFS-`oid` verification, enumerate multi-file MLX snapshots, and raise the MLX runtime to Ollama's control-surface bar with opt-in + degrade-to-Ollama selection. Then discharge the remaining provisioning/MCP/agent-builder debt.

**Tech Stack:** TypeScript (strict), Bun (runtime + `bun:test`), AI SDK v6 (`@ai-sdk/openai-compatible`), Node `fs`/`crypto` for atomic writes + hashing, OpenTelemetry spans (`src/telemetry/spans.ts`), MLX via `mlx_lm.server` (OpenAI-compat), Ollama.

## Global Constraints

- **Runtime/tooling:** `bun`, never `npm`. Typecheck `bun run typecheck`; single test `bun run test -- -t "name"`; file tests `bun run test:file -- "glob"`; lint `bun run lint:file -- "file"`.
- **No new npm deps** unless explicitly justified in a task (WS4 `gguf-parser` is a *documented keep-what-we-have* decision, not a dep add).
- **Code style:** `type` over `interface`; **string `enum` over union** for finite named sets (`enum Foo { A = 'A' }`); discriminated unions stay `type`; early returns; small focused files; descriptive names.
- **Hardcode nothing** — models/budgets/limits/paths computed live; env vars are fallback-only.
- **Degrade-never-crash** — every failure path degrades to the next option and logs; never throws to top-level.
- **Docs hard line** — the docs task updates ALL FOUR surfaces (architecture.md, README.md, ROADMAP.md, Artifact) + the SDD ledger; every spec/plan carries the arch-update + telemetry notes (in the spec).
- **AI SDK stays v6** — no v7/ts6/@ai-sdk major bumps ([[deferred-dependency-major-upgrades]]).
- **Enum-split invariant:** every pre-existing Ollama path must resolve to `runtime=Ollama, provider=Ollama` — no behavior change for Ollama.
- **Commits:** conventional `type(scope): summary`; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT commit `.remember/` or memory files with task commits.

---

## File Structure (decomposition map)

**WS1 — enum split**
- `src/core/types.ts` — add `RuntimeKind`; extend `ProviderKind`; rename `ModelDeclaration.provider`→`runtime`.
- `src/core/kind-map.ts` *(new)* — `downloadKindFor(runtime, repoShape)`.
- `src/provisioning/registry.ts`, `src/runtime/registry.ts`, `src/runtime/runtime.ts` — retype + reroute.
- `src/provisioning/catalog/hf-catalog.ts`, `src/discovery/huggingface-mlx.ts`, `src/discovery/huggingface-gguf.ts`, `src/discovery/build-registry.ts`, `src/discovery/discover.ts`, `src/cli/select-hook.ts`, `src/resource/model-manager.ts` — consumer updates.
- `src/provisioning/providers/lmstudio.ts` — retype to `ProviderKind.LmStudio`; wire into `providerFor`.

**WS2 — hf-fetch real download**
- `src/provisioning/providers/hf-fetch.ts` — write bytes, atomic rename, sha256, snapshot enumeration, retry/stall.
- `src/provisioning/types.ts` — add `destDir` to `download()` opts.
- `src/provisioning/provisioner.ts` — supply `destDir`.
- `src/provisioning/catalog/hf-catalog.ts` — capture `lfs.oid`; export a tree-listing used by snapshot download.

**WS3 — MLX runtime**
- `src/runtime/mlx-server.ts` — control-surface gaps + opt-in/degrade.
- `src/cli/select-hook.ts` — numCtx handling for MLX; degrade path.

**WS4 — provisioning polish**
- `src/provisioning/{fit,supervisor,provisioner}.ts`, `src/provisioning/providers/lmstudio.ts`, `src/provisioning/catalog/snapshot-source.ts`, `src/telemetry/spans.ts`.

**WS5 — MCP + agent-builder debt**
- `src/mcp/*` (OAuth, `addPackEntry`, sqlite gate, transport attr), `src/cli/chat.ts`, `src/cli/flow.ts`, `src/agent-builder/*`.

**Docs**
- `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`, Artifact.

---

## WS1 — Enum split (download `ProviderKind` vs inference `RuntimeKind`)

### Task 1: Add `RuntimeKind` + extend `ProviderKind` + `downloadKindFor`

**Files:**
- Modify: `src/core/types.ts` (enum `ProviderKind` at lines 2-5; `ModelDeclaration` at ~line 50)
- Create: `src/core/kind-map.ts`
- Test: `tests/core/kind-map.test.ts`

**Interfaces:**
- Produces:
  - `enum ProviderKind { Ollama='Ollama', HfGguf='HfGguf', HfSnapshot='HfSnapshot', LmStudio='LmStudio' }`
  - `enum RuntimeKind { Ollama='Ollama', MlxServer='MlxServer', LmStudio='LmStudio' }`
  - `ModelDeclaration.runtime: RuntimeKind` (was `.provider: ProviderKind`)
  - `Candidate.provider: ProviderKind` (unchanged field name; retyped — see Task 2)
  - `downloadKindFor(runtime: RuntimeKind, repoShape: 'gguf-file' | 'snapshot' | 'ollama'): ProviderKind`

- [ ] **Step 1: Write the failing test** — `tests/core/kind-map.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind, ProviderKind } from '../../src/core/types.ts';
import { downloadKindFor } from '../../src/core/kind-map.ts';

describe('downloadKindFor', () => {
  it('maps Ollama runtime to Ollama download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'ollama')).toBe(ProviderKind.Ollama);
  });
  it('maps MLX runtime + snapshot repo to HfSnapshot download', () => {
    expect(downloadKindFor(RuntimeKind.MlxServer, 'snapshot')).toBe(ProviderKind.HfSnapshot);
  });
  it('maps a single-file gguf under Ollama runtime to HfGguf download', () => {
    expect(downloadKindFor(RuntimeKind.Ollama, 'gguf-file')).toBe(ProviderKind.HfGguf);
  });
  it('maps LmStudio runtime to LmStudio download', () => {
    expect(downloadKindFor(RuntimeKind.LmStudio, 'snapshot')).toBe(ProviderKind.LmStudio);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/core/kind-map.test.ts"`
Expected: FAIL — `RuntimeKind`/`downloadKindFor` not exported.

- [ ] **Step 3: Edit `src/core/types.ts`**

Replace the two-member `ProviderKind` with the download enum, add `RuntimeKind`, and rename the declaration field:

```ts
/** Which downloader fetches a model's weights. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama', // pull via the local Ollama daemon
  HfGguf = 'HfGguf', // single GGUF file from a HuggingFace repo (repo::file.gguf)
  HfSnapshot = 'HfSnapshot', // whole-repo snapshot (MLX weights) from HuggingFace
  LmStudio = 'LmStudio', // download via the local LM Studio REST server
}

/** Which local engine runs inference for a model. */
export enum RuntimeKind {
  Ollama = 'Ollama', // GGUF via llama.cpp Metal (MLX engine auto on >32GB hosts)
  MlxServer = 'MlxServer', // MLX via a local OpenAI-compatible server (mlx_lm / LM Studio)
  LmStudio = 'LmStudio', // reserved: LM Studio as an inference runtime (download-only in Slice 18)
}
```

In `ModelDeclaration`, change `provider: ProviderKind` → `runtime: RuntimeKind`.

- [ ] **Step 4: Create `src/core/kind-map.ts`**

```ts
import { ProviderKind, RuntimeKind } from './types.ts';

export type RepoShape = 'gguf-file' | 'snapshot' | 'ollama';

/** Map an inference runtime + repo shape to the download provider that fetches it. */
export function downloadKindFor(runtime: RuntimeKind, shape: RepoShape): ProviderKind {
  if (runtime === RuntimeKind.LmStudio) return ProviderKind.LmStudio;
  if (runtime === RuntimeKind.MlxServer) return ProviderKind.HfSnapshot;
  // RuntimeKind.Ollama:
  if (shape === 'gguf-file') return ProviderKind.HfGguf;
  return ProviderKind.Ollama;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test:file -- "tests/core/kind-map.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/kind-map.ts tests/core/kind-map.test.ts
git commit -m "feat(core): split ProviderKind (download) from RuntimeKind (inference) + downloadKindFor"
```
(Typecheck will be red across consumers until Task 2–4 — that is expected and fixed within WS1.)

---

### Task 2: Reroute the download registry + wire LM Studio

**Files:**
- Modify: `src/provisioning/registry.ts` (full file, `providerFor` at :20, `catalogSourcesFor` at :32, `enrichSize` at :44)
- Modify: `src/provisioning/providers/lmstudio.ts:27` (kind field)
- Modify: `src/provisioning/providers/hf-fetch.ts:22,30` (accept split kinds — interim, WS2 completes behavior)
- Test: `tests/provisioning/registry.test.ts` *(new)*

**Interfaces:**
- Consumes: `ProviderKind` (Task 1), `createLmStudioProvider` (`lmstudio.ts`), `createHfFetchProvider` (`hf-fetch.ts`).
- Produces: `providerFor(kind: ProviderKind): DownloadProvider` routing all four kinds.

- [ ] **Step 1: Write the failing test** — `tests/provisioning/registry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { providerFor } from '../../src/provisioning/registry.ts';

describe('providerFor', () => {
  it('routes HfGguf and HfSnapshot to the HF fetcher (kind preserved)', () => {
    expect(providerFor(ProviderKind.HfGguf).kind).toBe(ProviderKind.HfGguf);
    expect(providerFor(ProviderKind.HfSnapshot).kind).toBe(ProviderKind.HfSnapshot);
  });
  it('routes LmStudio to the LM Studio provider', () => {
    expect(providerFor(ProviderKind.LmStudio).kind).toBe(ProviderKind.LmStudio);
  });
  it('routes Ollama to the Ollama provider', () => {
    expect(providerFor(ProviderKind.Ollama).kind).toBe(ProviderKind.Ollama);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/provisioning/registry.test.ts"`
Expected: FAIL — `providerFor` doesn't handle the new kinds / LM Studio kind mismatch.

- [ ] **Step 3: Edit `src/provisioning/registry.ts`**

Import `createLmStudioProvider`; rewrite `providerFor`:

```ts
import { createLmStudioProvider } from './providers/lmstudio.ts';
// ...
export function providerFor(kind: ProviderKind): DownloadProvider {
  switch (kind) {
    case ProviderKind.Ollama:
      return createOllamaProvider();
    case ProviderKind.HfGguf:
      return createHfFetchProvider(ProviderKind.HfGguf);
    case ProviderKind.HfSnapshot:
      return createHfFetchProvider(ProviderKind.HfSnapshot);
    case ProviderKind.LmStudio:
      return createLmStudioProvider();
    default:
      return createOllamaProvider();
  }
}
```

In `catalogSourcesFor`, change `createHfCatalogSource(ProviderKind.MlxServer)` → `createHfCatalogSource(ProviderKind.HfSnapshot)`. In `enrichSize`, the non-Ollama branch already sums the HF tree — leave as-is (works for both HF kinds).

- [ ] **Step 4: Edit `src/provisioning/providers/lmstudio.ts:27`**

Change `kind: ProviderKind.MlxServer` → `kind: ProviderKind.LmStudio` (drop the shared-kind comment).

- [ ] **Step 5: Run to verify it passes**

Run: `bun run test:file -- "tests/provisioning/registry.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/provisioning/registry.ts src/provisioning/providers/lmstudio.ts tests/provisioning/registry.test.ts
git commit -m "feat(provisioning): route HfGguf/HfSnapshot/LmStudio download kinds + wire dead LM Studio provider"
```

---

### Task 3: Retype the inference runtime registry + `Runtime.kind`

**Files:**
- Modify: `src/runtime/runtime.ts:22` (`Runtime.kind: RuntimeKind`)
- Modify: `src/runtime/registry.ts` (`runtimeFor(kind: RuntimeKind)`, :8-12)
- Modify: `src/runtime/mlx-server.ts:30` (`kind: RuntimeKind.MlxServer`)
- Modify: `src/runtime/ollama.ts` (`kind: RuntimeKind.Ollama`)
- Test: `tests/runtime/registry.test.ts` *(new)*

**Interfaces:**
- Consumes: `RuntimeKind` (Task 1).
- Produces: `runtimeFor(kind: RuntimeKind): Runtime`; `Runtime.kind: RuntimeKind`.

- [ ] **Step 1: Write the failing test** — `tests/runtime/registry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';

describe('runtimeFor', () => {
  it('returns the Ollama runtime', () => {
    expect(runtimeFor(RuntimeKind.Ollama).kind).toBe(RuntimeKind.Ollama);
  });
  it('returns the MLX server runtime', () => {
    expect(runtimeFor(RuntimeKind.MlxServer).kind).toBe(RuntimeKind.MlxServer);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/runtime/registry.test.ts"`
Expected: FAIL — types/kinds mismatch.

- [ ] **Step 3: Edit the three runtime files**

- `src/runtime/runtime.ts`: `import { RuntimeKind }`; `kind: RuntimeKind` on the `Runtime` type.
- `src/runtime/registry.ts`: `runtimeFor(kind: RuntimeKind): Runtime` and `availableRuntimes` unchanged in body.
- `src/runtime/mlx-server.ts:4,30`: import `RuntimeKind`; `kind: RuntimeKind.MlxServer`.
- `src/runtime/ollama.ts`: import `RuntimeKind`; `kind: RuntimeKind.Ollama`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file -- "tests/runtime/registry.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/ tests/runtime/registry.test.ts
git commit -m "feat(runtime): retype runtimeFor + Runtime.kind to RuntimeKind"
```

---

### Task 4: Thread `runtime`/`provider` through discovery + selection consumers

**Files:**
- Modify: `src/discovery/huggingface-mlx.ts:63,89`, `src/discovery/huggingface-gguf.ts`
- Modify: `src/provisioning/catalog/hf-catalog.ts:49`
- Modify: `src/cli/select-hook.ts:47,50`, `src/resource/model-manager.ts:37`, `src/discovery/build-registry.ts:40`, `src/discovery/discover.ts:75`
- Modify: tests hardcoding `ProviderKind.MlxServer`: `tests/discovery/huggingface-mlx.test.ts:13,49`, `tests/runtime/mlx-server.test.ts:6,8`, `tests/cli/select-hook.test.ts:29`
- Test: full suite is the regression gate here.

**Interfaces:**
- Consumes: `RuntimeKind`, `ProviderKind`, `downloadKindFor` (Tasks 1-3).
- Produces: discovered `ModelDeclaration`s carry `runtime`; `Candidate`s carry `provider` set via `downloadKindFor(runtime, shape)`.

- [ ] **Step 1: Update discovery to set both kinds**

In `src/discovery/huggingface-mlx.ts`: set discovered declarations' `runtime: RuntimeKind.MlxServer`; when producing a `Candidate`, set `provider: downloadKindFor(RuntimeKind.MlxServer, 'snapshot')` (= `HfSnapshot`). Change the host gate at :89 to `host.runtimes.includes(RuntimeKind.MlxServer)`.
In `src/discovery/huggingface-gguf.ts`: single-file GGUF → `runtime: RuntimeKind.Ollama`, `provider: downloadKindFor(RuntimeKind.Ollama, 'gguf-file')` (= `HfGguf`).

- [ ] **Step 2: Update `hf-catalog.ts:49` filter**

`kind === ProviderKind.HfSnapshot ? 'mlx' : 'gguf'` (the catalog source is now created with `HfSnapshot`).

- [ ] **Step 3: Update selection/manager consumers**

- `src/cli/select-hook.ts:47`: `runtimeFor(decl.runtime).createModel(decl)`.
- `src/cli/select-hook.ts:50`: `numCtx: decl.runtime === RuntimeKind.Ollama ? numCtx : undefined` (WS3 revisits this).
- `src/resource/model-manager.ts:37`: `controlFor: (decl) => runtimeFor(decl.runtime).control`.
- `src/discovery/build-registry.ts:40`: `runtimeFor(decl.runtime).control.isInstalled(...)`.
- `src/discovery/discover.ts:75`: pull via `providerFor(downloadKindFor(decl.runtime, shape))` OR the runtime's own control — match existing intent (Ollama pulls via runtime control; MLX/HF via `providerFor`). Where `discover.ts` currently does `runtimeFor(provider).control.pull`, keep runtime-control pull for Ollama; for MLX route the *download* via `providerFor`.

- [ ] **Step 4: Update the hardcoded-kind tests**

Replace `ProviderKind.MlxServer` with `RuntimeKind.MlxServer` in runtime/discovery/select-hook tests; where a test builds a `ModelDeclaration`, use `runtime:` not `provider:`; where a host lists runtimes, use `RuntimeKind`.

- [ ] **Step 5: Run typecheck + full suite (regression gate)**

Run: `bun run typecheck` then `bun test`
Expected: typecheck clean; suite green (the pre-Slice-18 count, adjusted for the 3 new tiny tests). Any residual `ProviderKind`↔`RuntimeKind` mismatch is a compile error — fix at the reported site.

- [ ] **Step 6: Commit**

```bash
git add src/discovery/ src/cli/select-hook.ts src/resource/model-manager.ts src/provisioning/catalog/hf-catalog.ts tests/
git commit -m "refactor: thread RuntimeKind (inference) + ProviderKind (download) through discovery + selection"
```

**WS1 checkpoint:** `bun run typecheck && bun test` fully green; Ollama paths unchanged (invariant).

---

## WS2 — hf-fetch real disk download

### Task 5: Add `destDir` to the download contract + supply it from the provisioner

**Files:**
- Modify: `src/provisioning/types.ts:27-30` (`download` opts)
- Modify: `src/provisioning/provisioner.ts:117` (pass `destDir`)
- Modify: `src/provisioning/providers/{ollama,lmstudio}.ts` (accept + ignore `destDir` — daemon owns disk)
- Test: `tests/provisioning/provisioner.test.ts` (extend or new assertion)

**Interfaces:**
- Produces: `download(modelRef, { onProgress, signal, destDir }): Promise<void>` where `destDir: string`.

- [ ] **Step 1: Write the failing test** — assert the provisioner passes a non-empty `destDir` to the provider.

```ts
import { describe, expect, it } from 'bun:test';
import { runProvision } from '../../src/provisioning/provisioner.ts';
// build minimal deps with a fake providerFor capturing opts; assert opts.destDir is a string dir.
it('passes a destDir to the download provider', async () => {
  let seen: string | undefined;
  const fakeProvider = { kind: 'HfSnapshot' as any, async download(_ref: string, o: any) { seen = o.destDir; } };
  // ...invoke runProvision with deps.providerFor = () => fakeProvider and one selected candidate...
  expect(typeof seen).toBe('string');
  expect(seen!.length).toBeGreaterThan(0);
});
```
(Use the existing provisioner test harness/fixtures as the scaffold; mirror its `deps` shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file -- "tests/provisioning/provisioner.test.ts"`
Expected: FAIL — `destDir` is `undefined`.

- [ ] **Step 3: Edit `src/provisioning/types.ts`**

```ts
download(
  modelRef: string,
  opts: { onProgress: (p: DownloadProgress) => void; signal: AbortSignal; destDir: string },
): Promise<void>;
```

- [ ] **Step 4: Edit `src/provisioning/provisioner.ts:117`**

Compute the dir once (env fallback only): `const destDir = process.env.HF_HOME ?? process.env.OLLAMA_MODELS ?? \`${process.cwd()}/model-images\`;` and pass `destDir` in the `download(...)` opts. Ollama/LM Studio providers accept the new opt and ignore it (their daemon owns disk).

- [ ] **Step 5: Run to verify it passes** — `bun run test:file -- "tests/provisioning/provisioner.test.ts"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/provisioning/types.ts src/provisioning/provisioner.ts src/provisioning/providers/ollama.ts src/provisioning/providers/lmstudio.ts tests/provisioning/provisioner.test.ts
git commit -m "feat(provisioning): add destDir to the download contract"
```

---

### Task 6: hf-fetch — single-file atomic write + sha256 (HfGguf)

**Files:**
- Modify: `src/provisioning/providers/hf-fetch.ts`
- Test: `tests/provisioning/hf-fetch.test.ts` (extend)

**Interfaces:**
- Consumes: `destDir` opt (Task 5), existing `sha256File(path)` helper, `ProgressTracker`, `DownloadPhase`.
- Produces: on `HfGguf` download, a file at `<destDir>/<file>` (atomic via `.part`→rename); phases include `Verifying` + `Finalizing`; no `.part` left on success or failure.

- [ ] **Step 1: Write the failing test** — download writes bytes to disk, no `.part` remains.

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// reuse streamingResponse() from the existing test file
it('HfGguf: writes the file to destDir atomically and reaches Done', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const chunk = new Uint8Array(1000);
  const provider = createHfFetchProvider(ProviderKind.HfGguf, {
    fetchImpl: (async () => streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
  });
  const phases: DownloadPhase[] = [];
  await provider.download('org/repo::model.gguf', {
    onProgress: (p) => phases.push(p.phase), signal: new AbortController().signal, destDir: dest,
  });
  const out = join(dest, 'model.gguf');
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out).byteLength).toBe(2000);
  expect(existsSync(out + '.part')).toBe(false);
  expect(phases).toContain(DownloadPhase.Finalizing);
  expect(phases.at(-1)).toBe(DownloadPhase.Done);
});
```

- [ ] **Step 2: Run to verify it fails** — `bun run test:file -- "tests/provisioning/hf-fetch.test.ts"` → FAIL (no file written; no `Finalizing`).

- [ ] **Step 3: Implement in `hf-fetch.ts`** — add a private `downloadFile(url, destPath, {onProgress, signal, tracker, expectedOid})` that:
  1. opens a write stream to `destPath + '.part'`;
  2. in the read loop writes each `value` chunk (`await write(value)`), accumulates `done`, emits `Downloading`;
  3. on loop end: emit `Verifying`; `const hash = await (deps.sha256 ?? sha256File)(destPath + '.part')`; if `expectedOid` present and `hash !== expectedOid` → throw `ProviderError` (finally unlinks `.part`);
  4. emit `Finalizing`; `await rename(destPath + '.part', destPath)`;
  5. wrap steps 1-4 in `try { ... } finally { if still exists, unlink .part }` so aborts/errors clean up.

  For `HfGguf` (`file` present), `destPath = join(destDir, file)`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch writes single GGUF files atomically with sha256"
```

---

### Task 7: hf-fetch — sha256 mismatch fails + cleans up

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts` (behavior already added in Task 6); Test: `tests/provisioning/hf-fetch.test.ts`.

- [ ] **Step 1: Write the failing test** — inject `sha256: async () => 'wronghash'` + an `expectedOid` and assert `download` rejects and no `.part`/final file remains.

```ts
it('fails and cleans up when sha256 mismatches the expected oid', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const provider = createHfFetchProvider(ProviderKind.HfGguf, {
    fetchImpl: (async () => streamingResponse([new Uint8Array(10)], 10)) as unknown as typeof fetch,
    sha256: async () => 'wronghash',
    resolveOid: async () => 'expectedhash', // see Task 8 for the dep name
  });
  await expect(provider.download('org/repo::m.gguf', {
    onProgress: () => {}, signal: new AbortController().signal, destDir: dest,
  })).rejects.toThrow();
  expect(existsSync(join(dest, 'm.gguf'))).toBe(false);
  expect(existsSync(join(dest, 'm.gguf.part'))).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** (if `resolveOid` not yet wired) — coordinate with Task 8; if Task 8 lands first, this passes after the mismatch branch exists.
- [ ] **Step 3: Ensure the mismatch branch throws + `finally` unlinks** (implemented in Task 6 step 3.3/3.5).
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "test(provisioning): hf-fetch fails+cleans up on sha256 mismatch"
```

---

### Task 8: Capture `lfs.oid` from the HF tree (verify-when-available)

**Files:**
- Modify: `src/provisioning/catalog/hf-catalog.ts:12,26` (`TreeEntry` + fetch), add an exported `hfTreeFiles(repo): Promise<{ path: string; size: number; oid?: string }[]>`
- Modify: `src/provisioning/providers/hf-fetch.ts` (accept `resolveOid?` dep or thread oid via the tree listing)
- Test: `tests/provisioning/hf-catalog.test.ts` (extend/new)

**Interfaces:**
- Produces: `hfTreeFiles(repo)` returns per-file `{ path, size, oid? }` where `oid` = `lfs.oid` when the entry is LFS-backed.

- [ ] **Step 1: Write the failing test** — a fake fetch returns a tree with an `lfs: { oid: 'abc', size: 5 }` entry; assert `hfTreeFiles` surfaces `oid: 'abc'`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Extend `TreeEntry`** to `{ path: string; size?: number; lfs?: { size?: number; oid?: string } }`; add `hfTreeFiles` mapping `oid = e.lfs?.oid`. Keep `hfTreeSize` working (sum `lfs?.size ?? size`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/catalog/hf-catalog.ts tests/provisioning/hf-catalog.test.ts
git commit -m "feat(provisioning): capture HF LFS oid (sha256) for download verification"
```

---

### Task 9: hf-fetch — multi-file snapshot enumeration (HfSnapshot)

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts`; Test: `tests/provisioning/hf-fetch.test.ts`.

**Interfaces:**
- Consumes: `hfTreeFiles(repo)` (Task 8), `downloadFile` (Task 6).
- Produces: on `HfSnapshot` (bare `repo`, no `::file`), downloads every tree file to `<destDir>/<repo>/<path>`, each atomic + oid-verified when available.

- [ ] **Step 1: Write the failing test** — fake `treeFiles` dep returns two files; fake fetch returns per-file bytes; assert both files exist under `<dest>/<repo>/…`, phases reach `Done`.

```ts
it('HfSnapshot: enumerates the repo tree and writes every file', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'hf-'));
  const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
    treeFiles: async () => [ { path: 'config.json', size: 3 }, { path: 'model.safetensors', size: 5 } ],
    fetchImpl: (async (u: string) => streamingResponse([new Uint8Array(u.endsWith('config.json') ? 3 : 5)], u.endsWith('config.json') ? 3 : 5)) as unknown as typeof fetch,
  });
  await provider.download('mlx-community/x', { onProgress: () => {}, signal: new AbortController().signal, destDir: dest });
  expect(existsSync(join(dest, 'mlx-community/x/config.json'))).toBe(true);
  expect(existsSync(join(dest, 'mlx-community/x/model.safetensors'))).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement the snapshot branch** — when `file` is absent: `const files = await (deps.treeFiles ?? hfTreeFiles)(repo);` then for each file `await downloadFile(\`${HF_RESOLVE}/${repo}/resolve/main/${f.path}\`, join(destDir, repo, f.path), { ..., expectedOid: f.oid })`, creating parent dirs (`mkdir(dirname, { recursive: true })`). Aggregate progress across files (sum sizes for `bytesTotal`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch downloads whole MLX snapshots (multi-file) to disk"
```

---

### Task 10: hf-fetch — retry + stall-watchdog parity

**Files:** Modify: `src/provisioning/providers/hf-fetch.ts` (wrap the fetch/loop in `withRetry` + `StallWatchdog` from `supervisor.ts`, mirroring `ollama.ts:26-27,72-88`); Test: `tests/provisioning/hf-fetch.test.ts`.

- [ ] **Step 1: Write the failing test** — a `fetchImpl` that throws on first call, succeeds on second; assert the file still downloads (retry engaged).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Wrap** the per-file download in `withRetry(fn, { attempts: 4, baseMs, capMs, jitter: true, signal })` and beat a `StallWatchdog(90_000, onStall)` on each chunk. On retry, the `.part` `finally`-cleanup from Task 6 guarantees a clean restart.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/provisioning/providers/hf-fetch.ts tests/provisioning/hf-fetch.test.ts
git commit -m "feat(provisioning): hf-fetch retry + stall-watchdog parity with Ollama"
```

**WS2 checkpoint:** `bun run typecheck && bun test` green; `hf-fetch` persists GGUF + MLX snapshots atomically.

---

## WS3 — MLX runtime to Ollama's bar

### Task 11: MLX control surface — real `isInstalled`/`listLoaded`/`getModelMax`

**Files:** Modify: `src/runtime/mlx-server.ts`; Test: `tests/runtime/mlx-server.test.ts` (extend, injecting a fake fetch).

**Interfaces:**
- Produces: `getModelMax(model)` returns a number when the server exposes it (else `undefined`); `listLoaded` returns real sizes when available; `pull` attempts a server-side load and degrades with a clear error.

- [ ] **Step 1: Write the failing test** — inject a fake `${BASE}/models` response exposing a context length / size; assert `getModelMax` returns it and `listLoaded` maps the id.
  (Refactor `mlx-server.ts` to accept an injectable `fetchImpl`/`baseUrl` via a `createMlxServerRuntime(deps)` factory so it's testable without a live server; export a default `mlxServerRuntime = createMlxServerRuntime()`.)
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the factory + fill `getModelMax`/`getModelKvArch` (return `undefined` when the server gives nothing — planner tolerates it), real `listLoaded` sizes when present, and a `pull` that checks `listIds()` then attempts the server's load endpoint if one exists, else throws the existing clear "load it in the server" error (degrade). Keep `embed` throwing `MemoryError` (honestly unsupported).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/runtime/mlx-server.ts tests/runtime/mlx-server.test.ts
git commit -m "feat(runtime): fill MLX control surface (getModelMax, listLoaded, pull best-effort) via injectable factory"
```

---

### Task 12: MLX selection — opt-in + degrade-to-Ollama

**Files:** Modify: `src/cli/select-hook.ts` (:47-50); Test: `tests/cli/select-hook.test.ts`.

**Interfaces:**
- Produces: when `decl.runtime === RuntimeKind.MlxServer` but the MLX runtime `isAvailable()` is false, selection degrades to the Ollama runtime (logged), never throwing.

- [ ] **Step 1: Write the failing test** — a declaration with `runtime: MlxServer` + an unavailable MLX runtime resolves to an Ollama-backed model (no throw).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** in `select-hook.ts`: `let rt = runtimeFor(decl.runtime); if (!(await rt.isAvailable()) && decl.runtime !== RuntimeKind.Ollama) { log degrade; rt = runtimeFor(RuntimeKind.Ollama); }` then `rt.createModel(decl)`. Pass `numCtx` when `rt.kind === RuntimeKind.Ollama`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/cli/select-hook.ts tests/cli/select-hook.test.ts
git commit -m "feat(runtime): MLX opt-in selection degrades to Ollama when unreachable"
```

---

### Task 13: MLX live-verify (both paths) + telemetry

**Files:**
- Create: `tests/integration/mlx-available.ts` (model-aware gate mirroring `ollama-available.ts`)
- Modify: `tests/integration/mlx.live.test.ts` (expand)
- Modify: `src/telemetry/spans.ts` (add MLX-selection attrs) + selection emit site
- **Live action (host):** install `mlx-lm`, run `mlx_lm.server`

- [ ] **Step 1: Install + run the MLX server (host).** Tell the user to run, via the `!` prefix:
  `! pip install mlx-lm` then `! mlx_lm.server --model mlx-community/Qwen2.5-3B-Instruct-4bit --port 1234`
- [ ] **Step 2: Write `mlx-available.ts`** — `export async function mlxReady(model?: string)` probing `mlxServerRuntime.isAvailable()` and (if `model`) `control.isInstalled(model)`.
- [ ] **Step 3: Expand `mlx.live.test.ts`** — under `describe.skipIf(!ready)`: (a) a real inference round-trip via `createModel(decl)` generating text; (b) `getModelMax` returns a number; (c) a WS2 real snapshot download of a tiny MLX repo to a temp dir, asserting files land on disk.
- [ ] **Step 4: Run the live tests** — `MLX_BASE_URL=http://localhost:1234/v1 bun run test:file -- "tests/integration/mlx.live.test.ts"` → PASS (not skipped).
- [ ] **Step 5: Verify Ollama's MLX path** — run an existing Ollama live inference test to confirm no regression: `bun run test:file -- "tests/integration/model-manager.live.test.ts"` (with Ollama up).
- [ ] **Step 6: Commit**

```bash
git add tests/integration/mlx-available.ts tests/integration/mlx.live.test.ts src/telemetry/spans.ts src/cli/select-hook.ts
git commit -m "test(runtime): live-verify MLX inference + snapshot download; emit MLX selection telemetry"
```

**WS3 checkpoint (LIVE-VERIFY GATE):** MLX inference + download live-verified end-to-end AND Ollama MLX path confirmed. Do not proceed to WS4 until this passes (per live-verify-before-merge).

---

## WS4 — Provisioning polish (Tier 2)

### Task 14: Wire the dead telemetry attrs + truthful `snapshotFallback`

**Files:** Modify: `src/telemetry/spans.ts` (`PROVISION_RUNTIME`, `PROVISION_DEFERRED_VERIFY`), `src/provisioning/provisioner.ts` (set them + real `snapshotFallback`); Test: `tests/provisioning/provisioner.test.ts` / a spans assertion.

- [ ] **Step 1: Write the failing test** — assert the provision span carries `PROVISION_RUNTIME` (the RuntimeKind) and a non-hardcoded `snapshotFallback`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — set `PROVISION_RUNTIME` = the model's `RuntimeKind`, `PROVISION_DEFERRED_VERIFY` when the download recorded (not verified) a hash, and thread the real `snapshotFallback` boolean from `catalogSourcesFor`/discovery into `withProvisionSpan`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(telemetry): emit PROVISION_RUNTIME/PROVISION_DEFERRED_VERIFY + truthful snapshotFallback`.

### Task 15: Provisioning robustness minors

**Files:** Modify: `src/provisioning/supervisor.ts` (remove dead per-attempt `AbortController` if truly unused — verify it's not the one passed into `fn`), `src/provisioning/providers/lmstudio.ts` (`bytesTotal: 0` → `null` in the `already_downloaded` branch); Tests: extend `lmstudio.test.ts` for the `already_downloaded` + `failed` branches (currently untested).

- [ ] **Step 1: Write failing tests** for `lmstudio` `already_downloaded` (emits `Done`, `bytesTotal: null`) and `failed` (emits `Failed`).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the `null` fix; remove the dead `AbortController` only after confirming `withRetry` creates the one actually passed to `fn`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `fix(provisioning): lmstudio bytesTotal null + cover already_downloaded/failed branches`.

### Task 16: Fit-math + sizing tuning

**Files:** Modify: `src/provisioning/fit.ts` (`bytesPerWeight` 0.56→~0.6; live Metal `recommendedMaxWorkingSetSize` read where available with a static fallback), decide gguf-parser (documented keep-HF-tree-sizing note in the file + spec's WS4 line); Test: `tests/provisioning/fit.test.ts`.

- [ ] **Step 1: Write/adjust the failing test** for the new `bytesPerWeight` constant and the Metal-read fallback path (inject the reader).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** with an injectable `recommendedMaxWorkingSetSize` reader (env/static fallback; never crash if unavailable). Add a one-line code comment documenting the conscious decision to keep HF-tree sizing rather than add `gguf-parser-go` (no new dep).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(provisioning): tune bytesPerWeight + live Metal working-set read (fallback-safe)`.

### Task 17: Snapshot-refresh automation + parallel downloads

**Files:** Modify/Create: `scripts/refresh-snapshot.ts` *(new, or a documented make target)*, `src/provisioning/provisioner.ts` (bounded-parallel downloads with a multi-bar), `src/provisioning/catalog/snapshot-source.ts`; Test: `tests/provisioning/provisioner.test.ts`.

- [ ] **Step 1: Write the failing test** — two selected candidates download concurrently (bounded), both recorded in `result.downloaded`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** a small bounded-concurrency runner (limit 2) around the download loop, each with its own progress bar; add `scripts/refresh-snapshot.ts` that regenerates `snapshot.json` from the live catalog sources (documented in the file header). Keep sequential fallback when `stdout` isn't a TTY.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(provisioning): bounded-parallel downloads + snapshot-refresh script`.

---

## WS5 — MCP + agent-builder debt (Tier 3 + 4)

### Task 18: MCP `MCP_TRANSPORT` attr emission

**Files:** Modify: `src/telemetry/spans.ts` (already defined at :60), the `mcp.mount` span emit site in the MCP mount code; Test: MCP mount span test.

- [ ] Steps: failing test asserting the mount span carries `MCP_TRANSPORT` (stdio/http) → implement emit → pass → commit `feat(telemetry): emit MCP_TRANSPORT on mount spans`.

### Task 19: sqlite read-only gate — allow `WITH…SELECT` CTEs

**Files:** Modify: `src/mcp/sqlite-server.ts` (the read-only statement gate); Test: `tests/mcp/sqlite-server.test.ts`.

- [ ] Steps: failing test — a `WITH x AS (SELECT 1) SELECT * FROM x` query is allowed while `INSERT`/`UPDATE`/`DELETE`/`DROP` stay rejected → implement (treat leading `WITH` whose top-level statement is `SELECT` as read-only) → pass → commit `fix(mcp): allow read-only WITH…SELECT CTEs in sqlite gate`.

### Task 20: `addPackEntry` check-then-act race → atomic

**Files:** Modify: the mcp.json pack writer (`src/mcp/*` `addPackEntry`); Test: mcp pack test.

- [ ] Steps: failing test — concurrent `addPackEntry` calls don't clobber; implement read-modify-write under a single atomic write (or a lock) → pass → commit `fix(mcp): make addPackEntry atomic (no check-then-act race)`.

### Task 21: `warnUnknownAgents` wired beyond flow.ts

**Files:** Modify: `src/cli/chat.ts` / `src/cli/crew*.ts` to call `warnUnknownAgents` (currently only `flow.ts`); Test: relevant CLI test.

- [ ] Steps: failing test — an unknown agent name warns in the chat/crew path → wire the call → pass → commit `fix(cli): warn on unknown agents in chat/crew paths`.

### Task 22: `chat.ts maybeAutoProvision` TTY predicate tidy

**Files:** Modify: `src/cli/chat.ts` (`maybeAutoProvision` at ~:30) to use the unified `interactiveTTY()` (stdin AND stderr) from `src/provisioning/ui/prompt.ts`; Test: chat TTY unit test.

- [ ] Steps: failing test — `maybeAutoProvision` doesn't prompt when stdin is not a TTY → replace the stderr-only check with `interactiveTTY()` → pass → commit `fix(cli): unify maybeAutoProvision TTY predicate with interactiveTTY()`.

### Task 23: MCP OAuth (`authProvider`) for remote servers

**Files:** Modify: `src/mcp/*` client-construction to accept an `authProvider` (OAuth) alongside static keys; Test: `tests/mcp/*` (contract-tested — live OAuth deferred).

- [ ] Steps: failing test — a pack entry with an `oauth` auth config constructs a client with an `authProvider` (mocked token) → implement the wiring per the AI SDK/MCP client OAuth surface → pass → commit `feat(mcp): OAuth authProvider for remote MCP servers (contract-tested)`.
  Note: **live OAuth verify stays deferred** (no server to auth against); GitHub remote-HTTP live-verify stays deferred pending `GITHUB_PAT` — log both in the SDD ledger.

### Task 24: Agent-builder — same-run auto-retry + tool-code generation

**Files:** Modify: `src/agent-builder/builder.ts` (+ `generate.ts`); Test: `tests/agent-builder/*`.

- [ ] Steps:
  - **Auto-retry:** failing test — a first structural-validation failure triggers ONE bounded regeneration before returning invalid → implement retry-once in `builder` (still no same-run *activation*) → pass.
  - **Tool-code generation:** failing test — the builder can emit a brand-new tool module (palette-guardrails still apply; propose-and-consent) → implement behind the existing consent gate → pass.
  - Commit `feat(agent-builder): same-run auto-retry + brand-new tool-code generation (consent-gated)`.

---

## Docs (all four surfaces + ledger) — REQUIRED before PR

### Task 25: Update all four doc surfaces + SDD ledger

**Files:** `docs/architecture.md`, `README.md`, `docs/ROADMAP.md`, `.superpowers/sdd/progress.md`, Artifact.

- [ ] **architecture.md:** §13 Provisioning (hf-fetch now download-complete; `HfGguf`/`HfSnapshot`; `LmStudio` wired; integrity posture), runtime section (`RuntimeKind` vs `ProviderKind`; MLX control surface; opt-in+degrade), MCP (OAuth, `MCP_TRANSPORT`), §18 agent-builder; module-map + data-flow diagrams for the split.
- [ ] **README.md:** Status line + slice table row (Slice 18 ✅) + MLX feature paragraph + "Next" line.
- [ ] **ROADMAP.md:** flip discharged items ✅ (Slice 18) across gap/phase/sequence tables; **renumber Phase-D breadth to Slice 19+**; keep explicitly-deferred items marked with reasons.
- [ ] **SDD ledger:** append Slice-18 per-task/review/fix/landing entries.
- [ ] **Artifact:** regenerate from architecture.md (new/changed nodes+edges for the split + MLX; footer slice/test counts); validate `node --check` + chip↔SCEN parity before deploy.
- [ ] **Run** `bun run docs:check` → clean.
- [ ] **Commit** `docs(sdd): Slice 18 — all four surfaces + ledger current`.

---

## Pre-merge (whole-branch)

- [ ] `bun run docs:check && bun run typecheck && bun run lint` then `bun test` — all green (full `bun run check` >2min; split it).
- [ ] Whole-branch adversarial review (fan-out per dimension) + fixes (per [[feedback-plan-sample-code-review-rigor]]).
- [ ] Confirm the WS3 live-verify gate passed (MLX both paths + Ollama regression).
- [ ] Open PR (head `slice-18-debt-wrapup-mlx`, base `main`); the pre-push slice-landing gate requires README + ROADMAP + SDD ledger updated in the same push.

## Self-review notes (author)

- **Spec coverage:** WS1↔Tasks1-4 (enum split D1/D1a); WS2↔Tasks5-10 (D2, dest-path, snapshot, oid, retry); WS3↔Tasks11-13 (D3, control surface, live-verify both paths); WS4↔Tasks14-17 (Tier 2 incl. telemetry attrs, fit, snapshot-refresh, parallel); WS5↔Tasks18-24 (Tier 3+4); Docs↔Task25 (all-4 + ledger + renumber). Non-goals explicitly preserved as deferred (Tasks 23 note).
- **Placeholders:** live-verify model id is concrete (`mlx-community/Qwen2.5-3B-Instruct-4bit`); WS4 gguf-parser is a documented keep-decision, not a TODO.
- **Type consistency:** `runtime: RuntimeKind` on `ModelDeclaration`, `provider: ProviderKind` on `Candidate`, `downloadKindFor(runtime, shape)` used identically in Tasks 1/4/5; `destDir` opt name consistent Tasks 5/6/9; `treeFiles`/`resolveOid`/`hfTreeFiles`/`oid` names consistent Tasks 6-9.
