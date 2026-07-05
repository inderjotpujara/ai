import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';
import { ProviderError } from '../../core/errors.ts';
import type { ProviderKind } from '../../core/types.ts';
import {
  defaultDownloadRetry,
  downloadStallMs,
} from '../../reliability/download-retry.ts';
import { withRetry } from '../../reliability/retry.ts';
import { IdleWatchdog } from '../../reliability/timeout.ts';
import { hfTreeFiles } from '../catalog/hf-catalog.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import {
  DownloadPhase,
  type DownloadProgress,
  type DownloadProvider,
} from '../types.ts';

const HF_RESOLVE = 'https://huggingface.co';

type RetryConfig = {
  attempts: number;
  baseMs: number;
  capMs: number;
  jitter: () => number;
};

/**
 * Joins `relPath` onto `destDir`, rejecting NUL bytes, absolute paths, and
 * any `..` traversal segment so the result cannot land outside `destDir`.
 * `relPath` originates from an untrusted modelRef (or, later, an HF tree
 * `path` entry) — reused by the multi-file snapshot writer for the same reason.
 */
export function safeJoin(destDir: string, relPath: string): string {
  if (
    relPath.includes('\0') ||
    isAbsolute(relPath) ||
    /(^|[/\\])\.\.([/\\]|$)/.test(relPath)
  ) {
    throw new ProviderError(`unsafe download path: ${relPath}`);
  }
  const base = resolve(destDir);
  const resolved = resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new ProviderError(`download path escapes destDir: ${relPath}`);
  }
  return resolved;
}

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

function writeChunk(stream: Writable, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

/**
 * Resolves only on 'error'; never resolves otherwise. Without a listener, a
 * write-side failure (EACCES/ENOSPC — real for large GGUF/MLX writes) would
 * emit 'error' on the WriteStream with no handler and crash the process
 * (Node's default behavior for unhandled EventEmitter errors), bypassing the
 * try/finally entirely and violating degrade-never-crash. Every write/end
 * await in `downloadFile` races against this promise so a stream error always
 * rejects the download instead of crashing. The `.catch(() => {})` only
 * silences the "unhandled rejection" warning on this standalone reference —
 * every real consumer still observes the rejection via `Promise.race`.
 */
function streamErrorGuard(stream: Writable): Promise<never> {
  const guard = new Promise<never>((_resolve, reject) => {
    stream.on('error', (err) =>
      reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  guard.catch(() => {});
  return guard;
}

/** Runtime-agnostic HuggingFace downloader (llama.cpp GGUF + MLX snapshot). We own the fetch. */
export function createHfFetchProvider(
  kind: ProviderKind,
  deps: {
    fetchImpl?: typeof fetch;
    sha256?: (path: string) => Promise<string>;
    /** Test seam: inject a Writable in place of `createWriteStream` to deterministically exercise stream-error handling. */
    openWriteStream?: (path: string) => Writable;
    /** Test/reuse seam: repo tree listing with per-file oid, reused by Task 9 for snapshots. */
    treeFiles?: (
      repo: string,
    ) => Promise<{ path: string; size: number; oid?: string }[]>;
    /** Test seam: override the per-file retry backoff (default mirrors ollama.ts's shape/jitter). */
    retry?: RetryConfig;
  } = {},
): DownloadProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sha256 = deps.sha256 ?? sha256File;
  const openWriteStream = deps.openWriteStream ?? createWriteStream;
  const treeFiles = deps.treeFiles ?? hfTreeFiles;
  const retry = deps.retry ?? defaultDownloadRetry();

  /**
   * Streams a single HF file to `<destPath>.part`, verifies its sha256, then
   * atomically renames it into place. Degrades to a clean state on any
   * failure/abort: the `.part` file is always removed, never the final file.
   * One attempt only — `downloadFile` below adds retry + stall-watchdog.
   */
  async function downloadFileOnce(
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
    let stream: Writable | undefined;
    try {
      stream = openWriteStream(partPath);
      const streamError = streamErrorGuard(stream);
      const reader = res.body.getReader();
      let done = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        if (!value) continue;
        await Promise.race([writeChunk(stream, value), streamError]);
        done += value.byteLength;
        onProgress(tracker.update(DownloadPhase.Downloading, done, total));
      }
      await Promise.race([endStream(stream), streamError]);

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
      // Destroy before unlink so we don't leak an open fd on the unlinked inode.
      if (stream && !stream.destroyed) stream.destroy();
      if (existsSync(partPath)) await unlink(partPath);
    }
  }

  /**
   * Retry + stall-watchdog parity with ollama.ts: a transient network blip
   * (fetch throws, or the transfer stalls) retries this one file instead of
   * failing the whole download outright. Each attempt re-invokes
   * `downloadFileOnce` from scratch, so its own `.part` finally-cleanup runs
   * per failed attempt and the next attempt always starts from a clean
   * `.part` (never appends to a stale one). `signal` aborts promptly: it is
   * threaded into both the retry loop (stops re-attempting) and a per-attempt
   * AbortController (stops the in-flight fetch/read immediately).
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
    const { onProgress, signal: outer, tracker, expectedOid } = opts;
    await withRetry(
      async () => {
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        outer.addEventListener('abort', onAbort);
        const watchdog = new IdleWatchdog(downloadStallMs(), () =>
          ctrl.abort(),
        );
        watchdog.start(5_000);
        try {
          await downloadFileOnce(url, destPath, {
            onProgress: (p) => {
              watchdog.beat(p.bytesCompleted);
              onProgress(p);
            },
            signal: ctrl.signal,
            tracker,
            expectedOid,
          });
        } finally {
          watchdog.stop();
          outer.removeEventListener('abort', onAbort);
        }
      },
      {
        attempts: retry.attempts,
        baseMs: retry.baseMs,
        capMs: retry.capMs,
        jitter: retry.jitter,
        // Per-file download retry, same as ollama.ts: retry on ANY failure
        // (network blip, stream error, stall abort), not just the Transient
        // lane — mirroring the pre-migration local withRetry.
        retryable: () => true,
        signal: outer,
        onRetry: (n) =>
          onProgress({ ...tracker.snapshot(), error: `retry ${n}` }),
      },
    );
  }

  /**
   * Looks up the LFS sha256 for `file` in `repo`'s tree so the download can
   * verify-when-available. A metadata-fetch failure is not a download
   * failure: degrade to `undefined` (compute-and-record, no gate) rather
   * than crash the whole download over a tree-listing hiccup.
   */
  async function resolveExpectedOid(
    repo: string,
    file: string,
  ): Promise<string | undefined> {
    try {
      const files = await treeFiles(repo);
      return files.find((e) => e.path === file)?.oid;
    } catch (err) {
      console.error(`HF tree lookup failed for ${repo}::${file}:`, err);
      return undefined;
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
        const expectedOid = await resolveExpectedOid(repo ?? '', file);
        await downloadFile(url, safeJoin(destDir, file), {
          onProgress,
          signal,
          tracker,
          expectedOid,
        });
        return { deferredVerify: expectedOid === undefined };
      }
      // HfSnapshot (multi-file): an MLX model is the whole repo. Enumerate
      // the tree ONCE (not per file — see Task 8's note) and download every
      // entry atomically to <destDir>/<repo>/<path>. Unlike the single-file
      // branch above, a tree-fetch failure here leaves nothing to enumerate,
      // so degrade the whole download by throwing (the provisioner catches
      // this into result.failed) rather than silently downloading nothing.
      let files: { path: string; size: number; oid?: string }[];
      try {
        files = await treeFiles(repo ?? '');
      } catch (err) {
        throw new ProviderError(
          `HF tree listing failed for ${repo}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const bytesTotal = files.reduce((sum, f) => sum + f.size, 0) || null;
      let completedBytes = 0;
      for (const f of files) {
        const destPath = safeJoin(destDir, `${repo}/${f.path}`);
        const fileUrl = `${HF_RESOLVE}/${repo}/resolve/main/${f.path}`;
        const bytesBeforeThisFile = completedBytes;
        await downloadFile(fileUrl, destPath, {
          // Re-scale this file's own (isolated) tracker output onto the
          // whole-snapshot byte range so percent climbs monotonically across
          // files instead of resetting/jumping backwards per file. Each
          // per-file download ends in its own terminal `Done` — relay that
          // as `Finalizing` instead, so the snapshot emits exactly one
          // `Done`, after the loop, once every file has landed.
          onProgress: (p) =>
            onProgress(
              tracker.update(
                p.phase === DownloadPhase.Done
                  ? DownloadPhase.Finalizing
                  : p.phase,
                bytesBeforeThisFile + p.bytesCompleted,
                bytesTotal,
              ),
            ),
          signal,
          tracker: new ProgressTracker(modelRef),
          expectedOid: f.oid,
        });
        completedBytes += f.size;
      }
      onProgress(
        tracker.update(DownloadPhase.Done, completedBytes, bytesTotal),
      );
      // Deferred (compute-and-record, no gate) if ANY file in the snapshot
      // landed without a tree oid to verify against.
      return { deferredVerify: files.some((f) => f.oid === undefined) };
    },
  };
}
