import type { ModelInventoryDTO, ModelListResponse } from '@contracts';
import {
  ModelListResponseSchema,
  RunLaunchResponseSchema,
  SpanDtoSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Mirrors `ATTR.MODEL_PULL_PERCENT` (`src/telemetry/spans.ts`, Task 15) —
 *  the web layer has no server-only `ATTR` import, so the wire key is
 *  duplicated here as a literal string. */
const PULL_PERCENT_ATTR = 'model.pull.progress.percent';

type PullState = { percent?: number; done: boolean };

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  const gb = bytes / 1e9;
  return `${gb.toFixed(1)} GB`;
}

/** Watches ONE model's pull run: opens the existing `/api/runs/:runId/stream`
 *  (D2 — no new stream code) and derives a percent from the latest
 *  `model.pull.progress` tick span's attributes. */
function usePullWatch(runId: string | undefined): PullState {
  const [state, setState] = useState<PullState>({ done: false });

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        for await (const span of createSseTransport().stream(
          runId,
          null,
          SpanDtoSchema,
          controller.signal,
        )) {
          if (cancelled) return;
          if (span.name === 'model.pull.progress') {
            const percent = span.attributes[PULL_PERCENT_ATTR];
            if (typeof percent === 'number') {
              setState((prev) => ({ ...prev, percent }));
            }
          }
        }
        if (!cancelled) setState((prev) => ({ ...prev, done: true }));
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, done: true }));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  return state;
}

function ModelRow({ item }: { item: ModelInventoryDTO }) {
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const pull = usePullWatch(runId);

  async function handlePull() {
    const res = await apiFetch('/models/pull', {
      method: 'POST',
      body: { runtime: item.runtime, modelRef: item.model },
      schema: RunLaunchResponseSchema,
    });
    setRunId(res.runId);
  }

  return (
    <tr>
      <td className="p-2 font-mono text-sm text-[var(--color-fg)]">
        {item.model}
      </td>
      <td className="p-2 font-mono text-sm text-[var(--color-muted)]">
        {item.runtime}
      </td>
      <td className="p-2 font-mono text-sm text-[var(--color-muted)]">
        {formatSize(item.sizeBytes)}
      </td>
      <td className="p-2">
        {item.installed ? (
          <span className="font-mono text-sm text-[var(--color-signal)]">
            Installed
          </span>
        ) : runId ? (
          <span
            data-testid={`models-progress-${item.model}`}
            className="font-mono text-sm text-[var(--color-muted)]"
          >
            {pull.percent !== undefined
              ? `${pull.percent}%`
              : pull.done
                ? 'Done'
                : '0%'}
          </span>
        ) : (
          <Button
            data-testid={`models-pull-${item.model}`}
            disabled={!item.fits}
            onClick={handlePull}
          >
            Pull
          </Button>
        )}
      </td>
    </tr>
  );
}

/** The Library area's Models tab (spec §4.4) — inventory table + a per-row
 *  Pull action that fires `POST /api/models/pull` then opens the EXISTING
 *  `/api/runs/:runId/stream` for live progress (D2 — no new web transport
 *  code). */
export function ModelsTab() {
  const [page, setPage] = useState<ModelListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/models', { schema: ModelListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load models',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RegionErrorBoundary region="Models">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-fg)]">Models</strong> failed to
          load. {error}
        </div>
      )}
      {!error && (
        <table className="w-full">
          <thead>
            <tr className="text-left font-mono text-xs uppercase text-[var(--color-muted)]">
              <th className="p-2">Model</th>
              <th className="p-2">Runtime</th>
              <th className="p-2">Size</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(page?.items ?? []).map((item) => (
              <ModelRow key={`${item.runtime}::${item.model}`} item={item} />
            ))}
          </tbody>
        </table>
      )}
    </RegionErrorBoundary>
  );
}
