import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import { isModelInstalled } from '../../resource/ollama-control.ts';
import { OllamaPullAggregator } from '../ollama-pull.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { StallWatchdog, withRetry } from '../supervisor.ts';
import {
  DownloadPhase,
  type DownloadProgress,
  type DownloadProvider,
} from '../types.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const STALL_MS = 90_000; // longer than Ollama's own 30s per-part watchdog

/** Stream one /api/pull attempt, feeding normalized progress until success or error. */
async function streamPull(
  baseUrl: string,
  model: string,
  onProgress: (p: DownloadProgress) => void,
  outer: AbortSignal,
): Promise<void> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer.addEventListener('abort', onAbort);
  const watchdog = new StallWatchdog(STALL_MS, () => ctrl.abort());
  watchdog.start(5_000);
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body)
      throw new ProviderError(`Ollama /api/pull returned ${res.status}`);
    const agg = new OllamaPullAggregator(new ProgressTracker(model));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const p = agg.feed(line);
        if (p) {
          watchdog.beat(p.bytesCompleted);
          onProgress(p);
          if (p.phase === DownloadPhase.Done) return;
        }
      }
    }
  } finally {
    watchdog.stop();
    outer.removeEventListener('abort', onAbort);
  }
}

export function createOllamaProvider(
  opts: { baseUrl?: string } = {},
): DownloadProvider {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  return {
    kind: ProviderKind.Ollama,
    async download(modelRef, { onProgress, signal }) {
      await withRetry(() => streamPull(baseUrl, modelRef, onProgress, signal), {
        attempts: 6,
        baseMs: 1_000,
        capMs: 45_000,
        jitter: () => 0.5 + Math.random() / 2, // full-ish jitter, kind to the registry
        onRetry: (n) =>
          onProgress({
            modelRef,
            phase: DownloadPhase.Resolving,
            bytesCompleted: 0,
            bytesTotal: null,
            percent: null,
            speedBytesPerSec: null,
            error: `retry ${n}`,
          }),
      });
      // Confirm the install actually landed before declaring done.
      if (!(await isModelInstalled(modelRef, baseUrl))) {
        throw new ProviderError(
          `Ollama reported success but ${modelRef} is not installed`,
        );
      }
    },
  };
}
