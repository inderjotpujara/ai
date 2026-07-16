import type { McpListResponse, McpServerDTO } from '@contracts';
import {
  McpAddRequestSchema,
  McpListResponseSchema,
  McpServerDtoSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { ConfirmPrompt } from '../chat/confirm-prompt.tsx';
import { useMcpTestMount } from './use-mcp-test-mount.ts';

/**
 * The Library area's MCP tab (spec §4.4, Increment 4's visible payoff):
 * configured-server list + status (`GET /api/mcp`, Task 24), an Add-server
 * form (`POST /api/mcp/add`), and a per-row Test-mount action that streams a
 * live mount attempt through `useMcpTestMount` — the SAME `postSseStream`
 * plumbing the builder wizard uses (Task 13), mid-flow consent included.
 */
export function McpTab() {
  const [page, setPage] = useState<McpListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [serverJson, setServerJson] = useState(
    '{"command":"bun","args":["run","src/mcp/server.ts"]}',
  );
  const { state, start, respond } = useMcpTestMount();

  function refresh() {
    apiFetch('/mcp', { schema: McpListResponseSchema })
      .then(setPage)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'failed to load'),
      );
  }

  useEffect(refresh, []);
  // Re-list once a test-mount attempt reaches its terminal result, so a
  // freshly mounted server's row picks up its new status without a manual
  // refresh (mirrors `ModelsTab`'s pull-then-relist precedent). `refresh` is a
  // plain per-render closure (not a stable ref); the trigger is `state.result`
  // alone — adding `refresh` would re-list on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (state.result) refresh();
  }, [state.result]);

  async function onAdd() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serverJson);
    } catch {
      setError('server JSON is not valid');
      return;
    }
    const body = McpAddRequestSchema.parse({
      name,
      server: parsed as Record<string, unknown>,
    });
    await apiFetch('/mcp/add', {
      method: 'POST',
      body,
      schema: McpServerDtoSchema,
    });
    setName('');
    refresh();
  }

  const servers: McpServerDTO[] = page?.items ?? [];

  return (
    <RegionErrorBoundary region="MCP">
      <div data-testid="library-mcp-tab" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {servers.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3 font-mono text-sm"
            >
              <span>{s.name}</span>
              <span className="text-[var(--color-muted)]">{s.kind}</span>
              <span className="text-[var(--color-muted)]">{s.status}</span>
              {s.reason && (
                <span className="text-[var(--color-muted)]">{s.reason}</span>
              )}
              <Button onClick={() => start(s.name)}>Test mount</Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <input
            data-testid="mcp-add-name"
            placeholder="server name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <textarea
            data-testid="mcp-add-server"
            value={serverJson}
            onChange={(e) => setServerJson(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm"
          />
          <Button variant="accent" onClick={onAdd}>
            Add server
          </Button>
        </div>

        {state.narration.length > 0 && (
          <ul className="font-mono text-xs text-[var(--color-muted)]">
            {state.narration.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {state.pendingConfirm && (
          <ConfirmPrompt ask={state.pendingConfirm} onAnswer={respond} />
        )}
        {state.result && (
          <p
            data-testid="mcp-test-mount-result"
            className="font-mono text-xs text-[var(--color-muted)]"
          >
            {state.result.name}: {state.result.status}
          </p>
        )}
      </div>
    </RegionErrorBoundary>
  );
}
