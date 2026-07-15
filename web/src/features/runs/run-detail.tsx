import type { CrewDetailDTO, RunDTO, WorkflowDetailDTO } from '@contracts';
import {
  CrewDetailDtoSchema,
  RunDtoSchema,
  RunLifecycle,
  SpanDtoSchema,
  WorkflowDetailDtoSchema,
} from '@contracts';
import { useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import type { DagModel } from '../../shared/dag/types.ts';
import { workflowGraph } from '../../shared/dag/workflow-graph.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { crewGraph } from '../crews/crew-graph.ts';
import { findRunGraphSource, stepStatusOverlay } from './run-dag.ts';
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
 *
 * Task 18 adds the live DAG overlay for workflow/crew runs (D8): a
 * Graph/Waterfall toggle appears once a `DagModel` is resolved, and
 * `stepStatusOverlay(spans)` lights up nodes as `workflow.step` spans close.
 * Two independent sources feed `dagModel`, per Amendment A:
 *   1. `graphKind`/`graphId` search params (set by the crew/workflow Run
 *      buttons, Tasks 15/17) — the def id is known at launch time, so the
 *      graph structure loads immediately, from t=0, with no run data needed.
 *   2. `findRunGraphSource(spans)` (`run-dag.ts`) — a cold-open fallback for
 *      a run opened from the Runs list (no search params), which can only
 *      resolve once the run's `workflow.run`/`crew.run` root span closes
 *      (that root closes LAST, since its wrapped function awaits every
 *      nested step — see `run-dag.ts`'s doc comment).
 * The search-param path is skipped entirely when params are absent, and the
 * telemetry-scan path is skipped entirely when params are present — never both.
 */
/**
 * Route entry: reads the `:runId` param and mounts a FRESH `RunDetailView` per
 * run via `key={runId}`. The `key` forces a full remount on navigation
 * (`/runs/a` → `/runs/b`), which resets `useRunTrace` — without it, run A's
 * spans would merge into run B's waterfall since the trace hook never clears.
 */
export function RunDetail() {
  const { runId } = useParams({ from: '/runs/$runId' });
  return <RunDetailView key={runId} runId={runId} />;
}

function loadGraph(kind: 'workflow' | 'crew', id: string): Promise<DagModel> {
  return kind === 'workflow'
    ? apiFetch<WorkflowDetailDTO>(`/workflows/${id}`, {
        schema: WorkflowDetailDtoSchema,
      }).then(workflowGraph)
    : apiFetch<CrewDetailDTO>(`/crews/${id}`, {
        schema: CrewDetailDtoSchema,
      }).then(crewGraph);
}

function RunDetailView({ runId }: { runId: string }) {
  const search = useSearch({ from: '/runs/$runId' });
  const [snapshot, setSnapshot] = useState<RunDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Set once the live-tail stream closes on its own (run finished → the server
  // ends the stream), so a snapshot captured mid-run stops showing "busy".
  const [streamEnded, setStreamEnded] = useState(false);
  const [dagModel, setDagModel] = useState<DagModel | undefined>(undefined);
  const [view, setView] = useState<'waterfall' | 'graph'>('waterfall');
  const { spans, cursor, ingest } = useRunTrace(snapshot?.spans ?? []);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    setError(undefined);
    setStreamEnded(false);
    setDagModel(undefined);
    setView('waterfall');
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
        // A real (non-abort) stream error must still clear the busy indicator —
        // otherwise "Run in progress…" sticks forever on a broken stream.
        setStreamEnded(true);
        console.error('[run-detail] live-tail stream failed', err);
      }
    }

    void tail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, snapshot]);

  // Amendment A — the primary launch→watch path: when the run was opened via
  // the crew/workflow Run button, `graphKind`/`graphId` are already on the
  // URL, so the def loads immediately (independent of `spans`/`snapshot`) and
  // the view auto-switches to Graph the instant it resolves — the graph is
  // visible from t=0, well before the run's root span could ever close.
  useEffect(() => {
    if (!search.graphKind || !search.graphId) return;
    let cancelled = false;
    loadGraph(search.graphKind, search.graphId)
      .then((model) => {
        if (cancelled) return;
        setDagModel(model);
        setView('graph');
      })
      .catch(() => {
        if (!cancelled) setDagModel(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [search.graphKind, search.graphId]);

  // Cold-open fallback: no graphKind/graphId (a run opened from the Runs
  // list) — derive the definition source from the live span trace instead.
  // Re-runs on every grown `spans` array so it resolves the instant the run's
  // root span closes; see run-dag.ts's `findRunGraphSource` doc comment for
  // why that's the earliest this path can resolve. Skipped entirely when the
  // search-param path above is already supplying the model.
  useEffect(() => {
    if (search.graphKind && search.graphId) return;
    const source = findRunGraphSource(spans);
    if (!source) {
      setDagModel(undefined);
      return;
    }
    let cancelled = false;
    loadGraph(source.kind, source.id)
      .then((model) => {
        if (!cancelled) setDagModel(model);
      })
      .catch(() => {
        if (!cancelled) setDagModel(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [spans, search.graphKind, search.graphId]);

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
            {dagModel && (
              <div className="mb-2 flex gap-2">
                <Button
                  data-testid="view-toggle-waterfall"
                  variant={view === 'waterfall' ? 'accent' : 'default'}
                  onClick={() => setView('waterfall')}
                >
                  Waterfall
                </Button>
                <Button
                  data-testid="view-toggle-graph"
                  variant={view === 'graph' ? 'accent' : 'default'}
                  onClick={() => setView('graph')}
                >
                  Graph
                </Button>
              </div>
            )}
            {dagModel && view === 'graph' ? (
              <DagView model={dagModel} statusById={stepStatusOverlay(spans)} />
            ) : (
              <Waterfall spans={spans} />
            )}
          </div>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
