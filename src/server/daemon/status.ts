import { DaemonStatusDtoSchema } from '../../contracts/index.ts';
import { readLivePid, readStartedAt } from '../../daemon/pid.ts';
import { recordDaemonStatusRead } from '../../daemon/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type DaemonStatusDeps = {
  daemonPidPath: string;
  bindInfo: {
    bind: string;
    allowedHosts: string[];
    port: number;
    sessionTtlMs: number;
  };
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

/**
 * `GET /api/daemon/status` — the Overview daemon card. Liveness from
 * `readLivePid` (clears a stale pid), uptime from the pid file's mtime (§7.3 —
 * robust to who answers, NOT `process.uptime()`), plus the bind posture the
 * Devices tab renders. Read-only: there is NO remote start/stop (D6).
 */
export function handleDaemonStatus(deps: DaemonStatusDeps): Response {
  const pid = readLivePid(deps.daemonPidPath);
  const startedAt =
    pid !== undefined ? readStartedAt(deps.daemonPidPath) : undefined;
  const uptimeMs =
    startedAt !== undefined ? Math.max(0, Date.now() - startedAt) : undefined;
  recordDaemonStatusRead();
  return json(
    DaemonStatusDtoSchema.parse({
      running: pid !== undefined,
      pid,
      startedAt,
      uptimeMs,
      bind: deps.bindInfo,
    }),
    200,
  );
}
