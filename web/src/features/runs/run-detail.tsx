import type { RunDTO } from '@contracts';
import { RunDtoSchema, RunLifecycle, SpanDtoSchema } from '@contracts';
import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { useRunTrace } from './use-run-trace.ts';
import { Waterfall } from './waterfall.tsx';

/**
 * Run detail: fetches the `RunDTO` snapshot (`GET /api/runs/:id`), seeds
 * `useRunTrace` with its spans, then live-tails the run-stream
 * (Task 13's SSE transport, `SpanDtoSchema`-typed) to ingest any spans
 * emitted after the snapshot was taken — the first real consumer of the
 * resumable transport port. Two effects: snapshot fetch (cancelled-flag
 * guarded) and the stream loop (started only once the snapshot resolves,
 * torn down on unmount/navigation by both a cancelled flag AND an
 * `AbortController.abort()` — the abort is what stops an idle stream between
 * frames, since a flag alone is only re-checked after the next frame yields).
 */
export function RunDetail() {
  const { runId } = useParams({ from: '/runs/$runId' });
  const [snapshot, setSnapshot] = useState<RunDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Set once the live-tail stream closes on its own (run finished → the server
  // ends the stream), so a snapshot captured mid-run stops showing "busy".
  const [streamEnded, setStreamEnded] = useState(false);
  const { spans, cursor, ingest } = useRunTrace(snapshot?.spans ?? []);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    setError(undefined);
    setStreamEnded(false);
    apiFetch(`/runs/${runId}`, { schema: RunDtoSchema })
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load run');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // `useRunTrace`'s initial-seed argument only runs on first mount (React's
  // lazy `useState` initializer), but the snapshot always resolves
  // asynchronously — so seed the trace by ingesting the snapshot's spans
  // once it arrives. `ingest` dedupes by spanId, so this is a no-op if the
  // trace already has them.
  useEffect(() => {
    if (!snapshot) return;
    for (const span of snapshot.spans) ingest(span);
  }, [snapshot, ingest]);

  // `cursor` is read only as the initial resume position when the stream
  // opens, not a restart trigger — including it would tear down and reopen
  // the stream on every ingested span. `ingest` is a stable useCallback ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    const controller = new AbortController();

    async function tail() {
      const stream = createSseTransport().stream(
        runId,
        cursor,
        SpanDtoSchema,
        controller.signal,
      );
      try {
        for await (const span of stream) {
          if (cancelled) return;
          ingest(span, span.eventId);
        }
        // Loop finished without an abort → the server closed the stream
        // because the run is no longer running; clear the busy indicator.
        if (!cancelled) setStreamEnded(true);
      } catch (err: unknown) {
        // A cleanup-triggered abort surfaces as an AbortError — expected, swallow it.
        if (
          cancelled ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        console.error('[run-detail] live-tail stream failed', err);
      }
    }

    void tail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, snapshot]);

  return (
    <RegionErrorBoundary region="Run">
      <section data-testid="run-detail" className="p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Run {runId}
        </h1>
        {snapshot?.lifecycle === RunLifecycle.Running && !streamEnded && (
          <p
            data-testid="run-busy"
            className="mt-1 text-xs text-[var(--color-accent)]"
          >
            Run in progress…
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Run</strong> failed to
            load. {error}
          </div>
        )}
        {!error && snapshot && (
          <div className="mt-4">
            <Waterfall spans={spans} />
          </div>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
