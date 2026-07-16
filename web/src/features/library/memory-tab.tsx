import type {
  MemoryIngestResponse,
  MemorySpaceDTO,
  RetrievalResultDTO,
} from '@contracts';
import {
  MemoryIngestResponseSchema,
  MemorySpaceDtoSchema,
  RetrievalResultDtoSchema,
} from '@contracts';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
// The Phase-2 upload helper (chat drag-drop/paste attachments) already does
// exactly what ingest needs: POST multipart to the confined `/api/upload`
// and return the server-minted id. Its name is image-flavored (it grew up
// alongside chat's image attachments) but the implementation is generic —
// it forwards whatever `File` it's given, and the server validates the
// media type. Reused here rather than forked (D11 / FORK-3: one upload path).
import { uploadImage } from '../chat/attachments.ts';

/** Both `GET /api/memory/spaces` and `POST /api/memory/:space/recall` return
 *  bare arrays on the wire (see `handleMemorySpaces`'s doc comment,
 *  `src/server/memory/spaces.ts`) — the `{items}`-wrapped `*ListResponseSchema`
 *  variants in `@contracts` describe a DIFFERENT, unused response shape for
 *  these two routes, so the array schemas are built locally instead. */
const SpaceListSchema = z.array(MemorySpaceDtoSchema);
const RecallListSchema = z.array(RetrievalResultDtoSchema);

/**
 * The Library area's Memory tab (spec §4.4, Increment 5's visible payoff):
 * a spaces list with per-space chunk counts, an upload+ingest flow (upload
 * a document through the confined `/api/upload`, then ingest the returned
 * `uploadId` into a space — never a raw filesystem path, FORK-3), and a
 * recall search box against `POST /api/memory/:space/recall`.
 */
export function MemoryTab() {
  const [spaces, setSpaces] = useState<MemorySpaceDTO[]>([]);
  const [space, setSpace] = useState('default');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievalResultDTO[]>([]);
  const [ingestResult, setIngestResult] = useState<
    MemoryIngestResponse | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  function refreshSpaces() {
    apiFetch('/memory/spaces', { schema: SpaceListSchema })
      .then(setSpaces)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'failed to load spaces'),
      );
  }

  useEffect(refreshSpaces, []);

  async function onIngest() {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setError(undefined);
    try {
      const fileId = await uploadImage(file);
      const result = await apiFetch(`/memory/${space}/ingest`, {
        method: 'POST',
        body: { fileId },
        schema: MemoryIngestResponseSchema,
      });
      setIngestResult(result);
      if (fileInput.current) fileInput.current.value = '';
      refreshSpaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ingest failed');
    }
  }

  async function onRecall() {
    setError(undefined);
    try {
      const r = await apiFetch(`/memory/${space}/recall`, {
        method: 'POST',
        body: { query },
        schema: RecallListSchema,
      });
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'recall failed');
    }
  }

  return (
    <RegionErrorBoundary region="Memory">
      <div data-testid="library-memory-tab" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {spaces.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3 font-mono text-sm"
            >
              <span>{s.name}</span>
              <span className="text-[var(--color-muted)]">
                {s.chunkCount} chunks
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="memory-space-input"
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <input
            data-testid="memory-file-input"
            type="file"
            accept=".md,.txt"
            ref={fileInput}
          />
          <Button onClick={onIngest}>Ingest into space</Button>
          {ingestResult && (
            <p
              data-testid="memory-ingest-result"
              className="font-mono text-xs text-[var(--color-muted)]"
            >
              {ingestResult.chunks} chunks
              {ingestResult.skipped ? ' (skipped: already ingested)' : ''}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="memory-recall-query"
            placeholder="Search this space…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <Button variant="accent" onClick={onRecall}>
            Recall
          </Button>
          <ul className="flex flex-col gap-2">
            {results.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-[var(--color-border)] p-2 font-mono text-xs"
              >
                <div className="text-[var(--color-muted)]">
                  {r.source} · {r.score.toFixed(2)}
                </div>
                <div>{r.text}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </RegionErrorBoundary>
  );
}
