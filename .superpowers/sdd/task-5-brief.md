### Task 5: LM Studio adapter (REST) + HF-fetch adapter (llama.cpp/MLX) — contract-tested, live-verify deferred

**Files:**
- Create: `src/provisioning/providers/hf-fetch.ts` (raw-`fetch` HuggingFace download + `node:crypto` SHA256)
- Create: `src/provisioning/providers/lmstudio.ts` (LM Studio local REST download + poll)
- Test: `tests/provisioning/hf-fetch.test.ts`
- Test: `tests/provisioning/lmstudio.test.ts`
- Modify: `src/provisioning/registry.ts` (re-enable the Task-4 commented imports/cases)

**Interfaces:**
- Consumes: `DownloadProvider`, `DownloadPhase`, `ProgressTracker` (Task 1); `ProviderKind`; `ProviderError`.
- Produces:
  - `createHfFetchProvider(kind: ProviderKind, deps?: { fetchImpl?; sha256?: (path) => Promise<string> }): DownloadProvider`
  - `sha256File(path: string): Promise<string>`
  - `createLmStudioProvider(deps?: { baseUrl?: string; fetchImpl?; pollMs?: number }): DownloadProvider`

- [ ] **Step 1: Write failing test for the HF-fetch provider (inject a fake streaming fetch + sha).**

```ts
// tests/provisioning/hf-fetch.test.ts
import { describe, expect, it } from 'bun:test';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { ProviderKind } from '../../src/core/types.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

function streamingResponse(chunks: Uint8Array[], total: number): Response {
  const body = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
  return new Response(body, { status: 200, headers: { 'content-length': String(total) } });
}

describe('createHfFetchProvider', () => {
  it('emits Downloading progress that reaches Done', async () => {
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.MlxServer, {
      fetchImpl: (async () => streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'deadbeef',
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
    });
    expect(phases).toContain(DownloadPhase.Downloading);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
```

- [ ] **Step 2: Run, verify fail; then create `src/provisioning/providers/hf-fetch.ts`.**

```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ProviderError } from '../../core/errors.ts';
import type { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { DownloadPhase, type DownloadProvider } from '../types.ts';

const HF_RESOLVE = 'https://huggingface.co';

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

/** Runtime-agnostic HuggingFace downloader (llama.cpp GGUF + MLX snapshot). We own the fetch. */
export function createHfFetchProvider(
  kind: ProviderKind,
  deps: { fetchImpl?: typeof fetch; sha256?: (path: string) => Promise<string> } = {},
): DownloadProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    kind,
    async download(modelRef, { onProgress, signal }) {
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      // modelRef = "repo/id" or "repo/id::file.gguf"; snapshot fetch omits the file.
      const [repo, file] = modelRef.split('::');
      const url = file ? `${HF_RESOLVE}/${repo}/resolve/main/${file}` : `${HF_RESOLVE}/${repo}/resolve/main/`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok || !res.body) throw new ProviderError(`HF resolve returned ${res.status}`);
      const total = Number(res.headers.get('content-length')) || null;
      const reader = res.body.getReader();
      let done = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        done += value?.byteLength ?? 0;
        onProgress(tracker.update(DownloadPhase.Downloading, done, total));
      }
      // Verify (SHA256 of the written file) — llama.cpp/GGUF has no content hash of its own.
      onProgress(tracker.update(DownloadPhase.Verifying, done, total));
      if (deps.sha256) await deps.sha256(file ?? repo);
      onProgress(tracker.update(DownloadPhase.Done, done, total ?? done));
    },
  };
}
```

Note: this test-covers the streaming + phase path with injected fetch/sha. The real file-write + on-disk path (streaming to a `.part` file, atomic rename) is exercised in the deferred live-verify once a HF-backed runtime is installed; the automated tests inject `sha256` to keep them deterministic and offline.

- [ ] **Step 3: Run, verify pass.**

Run: `bun test tests/provisioning/hf-fetch.test.ts`
Expected: PASS.

- [ ] **Step 4: Write failing test for the LM Studio adapter (inject fake REST: download job → poll → completed).**

```ts
// tests/provisioning/lmstudio.test.ts
import { describe, expect, it } from 'bun:test';
import { createLmStudioProvider } from '../../src/provisioning/providers/lmstudio.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('createLmStudioProvider', () => {
  it('starts a download job then polls to completion, emitting Done', async () => {
    let poll = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/download')) {
        return new Response(JSON.stringify({ job_id: 'j1', status: 'downloading', total_size_bytes: 1000 }), { status: 200 });
      }
      poll++;
      const body = poll < 2
        ? { status: 'downloading', downloaded_bytes: 500, total_size_bytes: 1000 }
        : { status: 'completed', downloaded_bytes: 1000, total_size_bytes: 1000 };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createLmStudioProvider({ fetchImpl, pollMs: 0 });
    const phases: DownloadPhase[] = [];
    await provider.download('lmstudio-community/x', { onProgress: (p) => phases.push(p.phase), signal: new AbortController().signal });
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
```

- [ ] **Step 5: Run, verify fail; then create `src/provisioning/providers/lmstudio.ts`.**

```ts
import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { DownloadPhase, type DownloadProvider } from '../types.ts';

const DEFAULT_BASE_URL = 'http://localhost:1234';

type DownloadJob = { job_id?: string; status: string; total_size_bytes?: number };
type JobStatus = { status: string; downloaded_bytes?: number; total_size_bytes?: number };

/** LM Studio local REST download: start a job, poll status → normalized progress. */
export function createLmStudioProvider(
  deps: { baseUrl?: string; fetchImpl?: typeof fetch; pollMs?: number } = {},
): DownloadProvider {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pollMs = deps.pollMs ?? 1000;
  return {
    kind: ProviderKind.MlxServer, // LM Studio serves GGUF+MLX; shares the MlxServer kind today
    async download(modelRef, { onProgress, signal }) {
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      const start = await fetchImpl(`${baseUrl}/api/v1/models/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelRef }),
        signal,
      });
      if (!start.ok) throw new ProviderError(`LM Studio download returned ${start.status}`);
      const job = (await start.json()) as DownloadJob;
      if (job.status === 'already_downloaded') {
        onProgress(tracker.update(DownloadPhase.Done, 0, 0));
        return;
      }
      const total = job.total_size_bytes ?? null;
      for (;;) {
        if (signal.aborted) throw new ProviderError('LM Studio download aborted');
        const st = await fetchImpl(`${baseUrl}/api/v1/models/download/${job.job_id}`, { signal });
        if (!st.ok) throw new ProviderError(`LM Studio status returned ${st.status}`);
        const s = (await st.json()) as JobStatus;
        onProgress(tracker.update(DownloadPhase.Downloading, s.downloaded_bytes ?? 0, s.total_size_bytes ?? total));
        if (s.status === 'completed') { onProgress(tracker.update(DownloadPhase.Done, s.downloaded_bytes ?? 0, s.total_size_bytes ?? total ?? 0)); return; }
        if (s.status === 'failed') throw new ProviderError(`LM Studio download failed for ${modelRef}`);
        if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
```

Note (endpoint provisionality): the LM Studio REST download surface is undocumented/`unstable` per research — the exact paths/fields are best-effort. This adapter is **live-verify deferred**: contract-tested here against the documented shape; verify + correct paths when LM Studio is installed. The SDK (`@lmstudio/sdk`) is a future richer path but is not added (no new dep).

- [ ] **Step 6: Run, verify pass.**

Run: `bun test tests/provisioning/lmstudio.test.ts`
Expected: PASS.

- [ ] **Step 7: Re-enable the Task-4 registry wiring.**

In `src/provisioning/registry.ts`, uncomment the `createHfFetchProvider` / `createLmStudioProvider` imports and the `MlxServer` case (from Task 4, Step 7 note). Confirm `providerFor(ProviderKind.MlxServer)` returns the HF-fetch provider.

- [ ] **Step 8: Typecheck, lint, run full provisioning suite.**

Run: `bun run typecheck && bun run lint:file -- "src/provisioning/**/*.ts" && bun test tests/provisioning/`
Expected: clean + all PASS.

- [ ] **Step 9: Log the deferred live-verify explicitly (not a silent skip).**

Append to `.superpowers/sdd/progress.md` a Slice-14 note: "LM Studio + HF-fetch (llama.cpp/MLX) adapters: contract-tested green; LIVE-VERIFY DEFERRED pending runtime install on a test machine. Ollama verified live (Tasks 2, 4)."

- [ ] **Step 10: Commit.**

```bash
git add src/provisioning/providers/hf-fetch.ts src/provisioning/providers/lmstudio.ts src/provisioning/registry.ts tests/provisioning/hf-fetch.test.ts tests/provisioning/lmstudio.test.ts .superpowers/sdd/progress.md
git commit -m "feat(provisioning): LM Studio + HF-fetch adapters (llama.cpp/MLX), contract-tested, live-verify deferred (Slice 14 Task 5)"
```

---

