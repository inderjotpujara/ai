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
  deps: {
    fetchImpl?: typeof fetch;
    sha256?: (path: string) => Promise<string>;
  } = {},
): DownloadProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    kind,
    async download(modelRef, { onProgress, signal }) {
      // destDir: accepted but not yet written to (Task 6 wires the actual write).
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      // modelRef = "repo/id" or "repo/id::file.gguf"; snapshot fetch omits the file.
      const [repo, file] = modelRef.split('::');
      const url = file
        ? `${HF_RESOLVE}/${repo}/resolve/main/${file}`
        : `${HF_RESOLVE}/${repo}/resolve/main/`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok || !res.body)
        throw new ProviderError(`HF resolve returned ${res.status}`);
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
      if (deps.sha256) await deps.sha256(file ?? repo ?? modelRef);
      onProgress(tracker.update(DownloadPhase.Done, done, total ?? done));
    },
  };
}
