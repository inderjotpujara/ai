import { currentRunId } from '../telemetry/run-router.ts';

export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

let sink: ((line: string) => void) | undefined;

/** Test seam: redirect log output to `fn` instead of stderr. Pass `undefined`
 *  to restore the default stderr sink. */
export function setLogSink(fn: ((line: string) => void) | undefined): void {
  sink = fn;
}

function level(): Level {
  const v = (process.env.AGENT_LOG_LEVEL ?? 'info').toLowerCase();
  return (v in ORDER ? v : 'info') as Level;
}

function emit(
  name: string,
  lvl: Level,
  msg: string,
  fields?: Record<string, unknown>,
) {
  if (ORDER[lvl] < ORDER[level()]) return;
  const rec = {
    ts: new Date().toISOString(),
    level: lvl,
    name,
    runId: currentRunId(),
    msg,
    ...fields,
  };
  const line =
    sink || !process.stderr.isTTY
      ? JSON.stringify(rec)
      : `${rec.ts.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${name}  ${msg}`;
  (sink ?? ((l: string) => process.stderr.write(`${l}\n`)))(line);
}

/** Creates a named structured logger. Each call emits one record to stderr:
 *  pretty when stderr is a TTY, else a JSON line stamped with the run id
 *  bound by `withRunContext` (see `src/telemetry/run-router.ts`). Level is
 *  gated by `AGENT_LOG_LEVEL` (default `info`). */
export function createLogger(name: string): Logger {
  return {
    debug: (m, f) => emit(name, 'debug', m, f),
    info: (m, f) => emit(name, 'info', m, f),
    warn: (m, f) => emit(name, 'warn', m, f),
    error: (m, f) => emit(name, 'error', m, f),
  };
}
