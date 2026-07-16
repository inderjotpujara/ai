import type { ProviderKind, RuntimeKind } from '../core/types.ts';
import {
  recordPullProgressTick,
  withModelPullSpan,
} from '../telemetry/spans.ts';
import { DownloadPhase, type DownloadProvider } from './types.ts';

export type PullBridgeDeps = {
  providerFor: (kind: ProviderKind) => DownloadProvider;
  destDir: string;
};

export type PullBridgeInput = {
  runtime: RuntimeKind;
  provider: ProviderKind;
  modelRef: string;
  signal: AbortSignal;
};

/**
 * Runs one model download under a `model.pull` root span, bridging each
 * `DownloadProgress` tick to its own short-lived `model.pull.progress` child
 * span (§7.2) so the live run-stream shows real-time progress instead of a
 * single post-hoc result. Emits ONE synthetic "started" tick immediately
 * (before the provider's first real `onProgress` callback) so the browser
 * shows something before the provider even resolves its manifest.
 *
 * Every tick's promise is tracked and awaited before the function returns —
 * `onProgress` is a SYNC callback, so each tick is fired with `void
 * recordPullProgressTick(...)` (never awaited inline, since a slow/backed-up
 * exporter must never make the download itself wait), but the LAST thing
 * this function does before `rec.outcome(...)` is `await Promise.all(pending)`
 * so no tick is left dangling past the root's own close (review requirement
 * (a): tick spans are genuinely short-lived and never left open).
 */
export async function runModelPullBridge(
  input: PullBridgeInput,
  deps: PullBridgeDeps,
): Promise<void> {
  const pending: Promise<void>[] = [];
  const tick = (p: Parameters<typeof recordPullProgressTick>[0]): void => {
    pending.push(recordPullProgressTick(p));
  };

  await withModelPullSpan(
    { runtime: input.runtime, modelRef: input.modelRef },
    async (rec) => {
      tick({
        phase: DownloadPhase.Resolving,
        percent: null,
        bytesCompleted: 0,
        bytesTotal: null,
        speedBytesPerSec: null,
      });
      try {
        const provider = deps.providerFor(input.provider);
        await provider.download(input.modelRef, {
          onProgress: (p) =>
            tick({
              phase: p.phase,
              percent: p.percent,
              bytesCompleted: p.bytesCompleted,
              bytesTotal: p.bytesTotal,
              speedBytesPerSec: p.speedBytesPerSec,
            }),
          signal: input.signal,
          destDir: deps.destDir,
        });
        await Promise.all(pending);
        rec.outcome('done');
      } catch (err) {
        await Promise.all(pending).catch(() => {});
        rec.outcome('failed');
        throw err; // review requirement (b): the root's status/outcome must reflect a real failure
      }
    },
  );
}
