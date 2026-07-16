import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { withRunTelemetry } from '../../cli/with-run.ts';
import { StatusEventType } from '../../contracts/enums.ts';
import { McpTestMountRequestSchema } from '../../contracts/index.ts';
import type { EventSink } from '../../core/events.ts';
import { loadMcpConfig } from '../../mcp/config.ts';
import { mapMcpDormantToDto, mapMcpEntryToDto } from '../../mcp/mcp-dto.ts';
import { withWallClock } from '../../reliability/timeout.ts';
import { newRunId } from '../../run/run-id.ts';
import { confirmWaitMs } from '../builders/config.ts';
import type { ConsentRegistry } from '../consent/registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { McpMountOne } from './mount-one.ts';
import type { McpMountStatus } from './mount-status.ts';

export type McpTestMountDeps = {
  runsRoot: string;
  mcpConfigPath: string;
  mcpMountStatus: McpMountStatus;
  consent: ConsentRegistry;
  mountOne: McpMountOne;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Wraps the consent await with `confirmWaitMs()`'s wall-clock cap, verbatim
 *  from the T11 builder route (`src/server/builders/build.ts`): a never-
 *  answered/abandoned consent (client got the `data-confirm` frame and never
 *  clicked, or navigated away) settles as a DECLINE — fail-closed, NEVER an
 *  auto-approve of a mount. That decline flows through `mountOne` to a normal
 *  'skipped' terminal, so `execute` always completes and the `mcp.mount` span +
 *  run-scoped telemetry always close instead of leaking on the long-lived
 *  daemon. Same helper/mechanism as T11 — not a new one. */
function withConfirmTimeout(ask: () => Promise<boolean>): Promise<boolean> {
  return withWallClock(confirmWaitMs(), ask).catch(() => false);
}

/**
 * `POST /api/mcp/test-mount` — the D1 interactive shape, identical to
 * `handleChat`'s: a `createUIMessageStream`/`writer.merge`/
 * `createUIMessageStreamResponse` SSE response whose `execute` callback does
 * NOT return until the whole mount attempt (including any awaited consent)
 * is done. Mints its own ephemeral run (D8) via `withRunTelemetry` (no MCP
 * mount of its OWN — `deps.mountOne` opens/closes its own scoped registry)
 * so the `mcp.mount` span it wraps lands in `runs/<id>/spans.jsonl`.
 */
export async function handleMcpTestMount(
  req: Request,
  deps: McpTestMountDeps,
): Promise<Response> {
  let body: ReturnType<typeof McpTestMountRequestSchema.parse>;
  try {
    body = McpTestMountRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid test-mount request' }, 400);
  }

  const cfg = loadMcpConfig(deps.mcpConfigPath);
  const entry = cfg.entries.find((e) => e.name === body.name);
  const dormant = cfg.dormant.find((d) => d.name === body.name);
  if (!entry && !dormant) return json({ error: 'not found' }, 404);

  const runId = newRunId();
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const events: EventSink = (e) =>
        writer.write({ type: e.type, data: e, transient: true });
      events({ type: StatusEventType.RunStart, runId });

      await withRunTelemetry({ runsRoot: deps.runsRoot, runId }, async () => {
        if (!entry) {
          // Reachable only when `dormant` matched above (the 404 guard rules
          // out "neither"); the `if (dormant)` both documents that and lets TS
          // narrow it without a non-null assertion.
          if (dormant) {
            events({
              type: StatusEventType.McpMount,
              server: body.name,
              outcome: 'dormant',
            });
            writer.write({
              type: 'data-mcp-server',
              data: mapMcpDormantToDto(dormant),
              transient: true,
            });
          }
          return;
        }
        events({
          type: StatusEventType.McpMount,
          server: entry.name,
          outcome: 'mounting',
        });
        const askRaw = async (question: string): Promise<boolean> =>
          Boolean(
            await deps.consent.port({ kind: 'mcp-mount', question }, events),
          );
        // Fail-closed wall-clock cap on the human consent await (T11 pattern):
        // an abandoned confirm resolves to DECLINE, not a perpetual suspend.
        const ask = (question: string): Promise<boolean> =>
          withConfirmTimeout(() => askRaw(question));
        const warn = (msg: string): void =>
          events({
            type: StatusEventType.McpMount,
            server: entry.name,
            outcome: `warn: ${msg}`,
          });

        // Mirror `build.ts`'s try/catch around `runBuilderTurn`: the terminal
        // `data-mcp-server` frame must be written EXACTLY ONCE on every path
        // (mounted, skipped/declined, timeout-decline, OR throw). On a throw
        // from the mount seam (reg.close / buildAuthProviders / span) we
        // synthesize a 'skipped' terminal carrying the error as its reason so
        // the run still reaches a terminal frame + `data-run-end` and the T25
        // UI never hangs on a started-but-never-ended run.
        let status: 'mounted' | 'skipped' = 'skipped';
        let reason: string | undefined;
        try {
          const result = await deps.mountOne(entry, { ask, warn });
          status = result.outcome;
          reason = result.reason;
        } catch (err) {
          reason = err instanceof Error ? err.message : String(err);
        }
        deps.mcpMountStatus.record(entry.name, status, reason);
        events({
          type: StatusEventType.McpMount,
          server: entry.name,
          outcome: status,
        });
        writer.write({
          type: 'data-mcp-server',
          data: mapMcpEntryToDto(entry, deps.mcpMountStatus.get(entry.name)),
          transient: true,
        });
      });

      events({ type: StatusEventType.RunEnd, runId, outcome: 'done' });
    },
    onError: (err) =>
      `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
