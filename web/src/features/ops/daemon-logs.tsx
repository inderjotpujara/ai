import type { DaemonLogsResponse } from '@contracts';
import { DaemonLogsResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';

type Stream = 'out' | 'err';

function toLogsPath(stream: Stream): string {
  const params = new URLSearchParams({ stream });
  return `/daemon/logs?${params.toString()}`;
}

/** Poll hook mirroring `useDaemonStatus`/`useQueueStats` (T32): fetch on
 *  mount + `setInterval(notifyConfig().pollMs)`, but with `stream` as a
 *  dependency (like `useJobs`'s `query`) so switching the out/err toggle
 *  re-fires the fetch with the new `stream=` param immediately. */
function useDaemonLogs(stream: Stream) {
  const [logs, setLogs] = useState<DaemonLogsResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch(toLogsPath(stream), { schema: DaemonLogsResponseSchema })
        .then((r) => !cancelled && setLogs(r))
        .catch(
          (e: unknown) =>
            !cancelled && setError(e instanceof Error ? e.message : 'failed'),
        );
    };
    load();
    const id = setInterval(load, notifyConfig().pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stream]);
  return { logs, error };
}

const STOP_COMMAND = 'agent daemon stop';

/** Daemon logs-tail viewer (Task 34, Slice 25b Incr 6): renders the
 *  server-redacted-and-bounded `GET /api/daemon/logs?tail=&stream=` tail
 *  (`DaemonLogsResponse.lines`) in a monospace block, with an out/err
 *  stream toggle, poll-refreshed on the same `notifyConfig().pollMs`
 *  cadence as `useDaemonStatus`/`useQueueStats`. The response is already
 *  redacted+bounded server-side (`handleDaemonLogs`) — this just renders
 *  `lines[]` as-is, no further trimming/filtering client-side.
 *
 *  Per D6 (bootstrap paradox — a remote-stop control could sever the very
 *  connection used to click it, with no local fallback): there is
 *  deliberately NO remote start/stop/restart button anywhere in this
 *  component. Daemon lifecycle stays CLI-only; this only prints the
 *  command to copy. */
export function DaemonLogs() {
  const [stream, setStream] = useState<Stream>('out');
  const { logs, error } = useDaemonLogs(stream);

  return (
    <div data-testid="ops-daemon-logs">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Logs
        </h3>
        <div className="flex gap-1">
          <Button
            data-testid="ops-daemon-logs-stream-out"
            variant={stream === 'out' ? 'accent' : 'default'}
            onClick={() => setStream('out')}
          >
            out
          </Button>
          <Button
            data-testid="ops-daemon-logs-stream-err"
            variant={stream === 'err' ? 'accent' : 'default'}
            onClick={() => setStream('err')}
          >
            err
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
          Logs failed to load. {error}
        </p>
      )}
      {!error && (
        <pre className="mt-2 max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-xs text-[var(--color-fg)]">
          {(logs?.lines ?? []).join('\n')}
        </pre>
      )}

      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Stop or restart the daemon from the CLI —{' '}
        <code className="font-mono">{STOP_COMMAND}</code>. There is no remote
        control for daemon lifecycle here.
      </p>
    </div>
  );
}
