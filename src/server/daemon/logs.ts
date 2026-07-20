import { closeSync, openSync, readSync, statSync } from 'node:fs';
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

/**
 * Cap on how many trailing bytes of a log file are ever read into memory —
 * 1 MiB, comfortably more than the `tail` schema's max of 2000 lines even at
 * a generous ~512 bytes/line. The daemon is always-on and rotation-less, so
 * `agent.{out,err}.log` grows unbounded; reading the WHOLE file (as this used
 * to) would block the event loop and can OOM the very process hosting the
 * web UI once the log reaches multi-GB size (§7.3 finding). Only this
 * bounded tail is ever read off disk — never the full file.
 */
const TAIL_READ_CAP_BYTES = 1024 * 1024; // 1 MiB

/**
 * Read only the last `min(size, TAIL_READ_CAP_BYTES)` bytes of `file` and
 * split them into lines. If the file is larger than the cap, the read starts
 * mid-file, so the first "line" in the chunk is possibly partial (we began
 * reading mid-line) — it is dropped rather than returned truncated. Throws
 * (propagated to the caller's try/catch) if the file is missing/unreadable;
 * returns `[]` for an empty file.
 */
function readTailLines(file: string): string[] {
  const size = statSync(file).size;
  if (size === 0) return [];
  const readSize = Math.min(size, TAIL_READ_CAP_BYTES);
  const start = size - readSize;
  const buffer = Buffer.alloc(readSize);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, readSize, start);
  } finally {
    closeSync(fd);
  }
  const rawLines = buffer.toString('utf8').split('\n');
  if (start > 0) rawLines.shift(); // possibly-partial first line — drop it
  return rawLines.filter((l) => l.length > 0);
}

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
 * and `tail` is capped at 2000 by the schema. The READ itself is also bounded
 * (`readTailLines`, §7.3): only the last `TAIL_READ_CAP_BYTES` of the file are
 * ever read off disk, never the whole file — the daemon is always-on and
 * rotation-less, so the log grows unbounded, and a whole-file read would
 * block the event loop / OOM the host on a multi-GB log. A missing/
 * unreadable/empty log file collapses to an empty `lines` array (degrade,
 * never 500) — a not-yet-booted daemon simply has no logs.
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
    const all = readTailLines(file);
    // Redaction runs BEFORE the response is constructed — no raw bytes are
    // ever placed in the body (§7.3: redact-before-bytes-leave).
    lines = all.slice(-query.tail).map(redactSecrets);
  } catch {
    lines = []; // absent/unreadable → no logs yet (degrade, never crash)
  }
  recordDaemonLogsRead();
  return json(DaemonLogsResponseSchema.parse({ lines }), 200);
}
