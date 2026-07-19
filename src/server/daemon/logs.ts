import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import {
  DaemonLogsQuerySchema,
  DaemonLogsResponseSchema,
} from '../../contracts/index.ts';
import { recordDaemonLogsRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { redactSecrets } from './redact.ts';

export type DaemonLogsDeps = { daemonLogDir: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `GET /api/daemon/logs?tail=&stream=out|err` — a REDACTED tail of
 * `~/.agent/logs/agent.{out,err}.log`. Every returned line runs through
 * `redactSecrets` (§7.3) so the root/session token can never leak over HTTP,
 * and `tail` is capped at 2000 by the schema so this can't stream an unbounded
 * file — the file is read whole then sliced to the last N lines (log files are
 * small/rotated; there is no partial/streaming reader in this codebase, and
 * the schema cap bounds the RESPONSE regardless of file size). A missing/
 * unreadable log file collapses to an empty `lines` array (degrade, never
 * 500) — a not-yet-booted daemon simply has no logs.
 */
export function handleDaemonLogs(
  params: URLSearchParams,
  deps: DaemonLogsDeps,
): Response {
  let query: ReturnType<typeof DaemonLogsQuerySchema.parse>;
  try {
    query = DaemonLogsQuerySchema.parse({
      tail: params.get('tail') ?? undefined,
      stream: params.get('stream') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }
  const file = join(deps.daemonLogDir, `agent.${query.stream}.log`);
  let lines: string[] = [];
  try {
    const raw = readFileSync(file, 'utf8');
    const all = raw.split('\n').filter((l) => l.length > 0);
    // Redaction runs BEFORE the response is constructed — no raw bytes are
    // ever placed in the body (§7.3: redact-before-bytes-leave).
    lines = all.slice(-query.tail).map(redactSecrets);
  } catch {
    lines = []; // absent/unreadable → no logs yet (degrade, never crash)
  }
  recordDaemonLogsRead();
  return json(DaemonLogsResponseSchema.parse({ lines }), 200);
}
