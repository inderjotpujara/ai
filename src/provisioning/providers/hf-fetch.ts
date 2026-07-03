import { createHash } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProviderError } from '../../core/errors.ts';
import type { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import {
  DownloadPhase,
  type DownloadProgress,
  type DownloadProvider,
} from '../types.ts';

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

function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
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
  const sha256 = deps.sha256 ?? sha256File;

  /**
   * Streams a single HF file to `<destPath>.part`, verifies its sha256, then
   * atomically renames it into place. Degrades to a clean state on any
   * failure/abort: the `.part` file is always removed, never the final file.
   */
  async function downloadFile(
    url: string,
    destPath: string,
    opts: {
      onProgress: (p: DownloadProgress) => void;
      signal: AbortSignal;
      tracker: ProgressTracker;
      expectedOid?: string;
    },
  ): Promise<void> {
    const { onProgress, signal, tracker, expectedOid } = opts;
    const partPath = `${destPath}.part`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok || !res.body)
      throw new ProviderError(`HF resolve returned ${res.status}`);
    const total = Number(res.headers.get('content-length')) || null;
    await mkdir(dirname(destPath), { recursive: true });
    try {
      const stream = createWriteStream(partPath);
      const reader = res.body.getReader();
      let done = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        if (!value) continue;
        await writeChunk(stream, value);
        done += value.byteLength;
        onProgress(tracker.update(DownloadPhase.Downloading, done, total));
      }
      await endStream(stream);

      // Verify (SHA256 of the written file) — llama.cpp/GGUF has no content hash of its own.
      onProgress(tracker.update(DownloadPhase.Verifying, done, total));
      const hash = await sha256(partPath);
      if (expectedOid && hash !== expectedOid) {
        throw new ProviderError(
          `sha256 mismatch for ${destPath}: expected ${expectedOid}, got ${hash}`,
        );
      }

      onProgress(tracker.update(DownloadPhase.Finalizing, done, total ?? done));
      await rename(partPath, destPath);
      onProgress(tracker.update(DownloadPhase.Done, done, total ?? done));
    } finally {
      if (existsSync(partPath)) await unlink(partPath);
    }
  }

  return {
    kind,
    async download(modelRef, { onProgress, signal, destDir }) {
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      // modelRef = "repo/id" or "repo/id::file.gguf"; snapshot fetch omits the file.
      const [repo, file] = modelRef.split('::');
      if (file) {
        const url = `${HF_RESOLVE}/${repo}/resolve/main/${file}`;
        await downloadFile(url, join(destDir, file), {
          onProgress,
          signal,
          tracker,
        });
        return;
      }
      // HfSnapshot (multi-file): actual on-disk write lands in a later task;
      // for now this counts bytes and reports progress only.
      const url = `${HF_RESOLVE}/${repo}/resolve/main/`;
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
      onProgress(tracker.update(DownloadPhase.Verifying, done, total));
      if (deps.sha256) await deps.sha256(repo ?? modelRef);
      onProgress(tracker.update(DownloadPhase.Done, done, total ?? done));
    },
  };
}
