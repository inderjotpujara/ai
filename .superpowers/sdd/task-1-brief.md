### Task 1: Structured leveled logger

**Files:**
- Create: `src/log/logger.ts`
- Create: `tests/log/logger.test.ts`
- Modify: `src/telemetry/run-router.ts` (export `currentRunId(): string | undefined`)
- Modify: `src/cli/chat.ts` (replace the representative status `console.error` calls at `:191`, `:195` with `log.info(...)`)

**Interfaces:**
- Consumes: OTel context run-id set by Plan 1's `withRunContext`.
- Produces:
  - `currentRunId(): string | undefined` (added to `run-router.ts`) — reads `RUN_ID_KEY` from the active context.
  - `createLogger(name: string): Logger` where `Logger = { debug; info; warn; error }`, each `(msg: string, fields?: Record<string, unknown>) => void`. Emits one record to stderr: pretty (`HH:MM:SS LEVEL name msg`) when stderr is a TTY, else a JSON line `{ ts, level, name, runId, msg, ...fields }`. Level gate via `AGENT_LOG_LEVEL` (default `info`; order debug<info<warn<error).
  - `setLogSink(fn: (line: string) => void): void` — test seam to capture output.

- [ ] **Step 1: Write the failing test**

```ts
// tests/log/logger.test.ts
import { afterEach, expect, test } from 'bun:test';
import { createLogger, setLogSink } from '../../src/log/logger.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

afterEach(() => { setLogSink(undefined); delete process.env.AGENT_LOG_LEVEL; });

test('emits JSON with level, name, msg, fields and stamps runId from context', () => {
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('test');
  withRunContext('run-xyz', () => log.info('hello', { k: 1 }));
  const rec = JSON.parse(lines[0]);
  expect(rec).toMatchObject({ level: 'info', name: 'test', msg: 'hello', k: 1, runId: 'run-xyz' });
});

test('respects AGENT_LOG_LEVEL gate', () => {
  process.env.AGENT_LOG_LEVEL = 'warn';
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('t');
  log.info('skip'); log.warn('keep');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).msg).toBe('keep');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/log/logger.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Add `currentRunId` to run-router**

In `src/telemetry/run-router.ts`, export:

```ts
import { context } from '@opentelemetry/api'; // already imported
// RUN_ID_KEY already defined in Plan 1
export function currentRunId(): string | undefined {
  return context.active().getValue(RUN_ID_KEY) as string | undefined;
}
```

- [ ] **Step 4: Implement the logger**

```ts
// src/log/logger.ts
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
export function setLogSink(fn: ((line: string) => void) | undefined): void { sink = fn; }

function level(): Level {
  const v = (process.env.AGENT_LOG_LEVEL ?? 'info').toLowerCase();
  return (v in ORDER ? v : 'info') as Level;
}
function emit(name: string, lvl: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[lvl] < ORDER[level()]) return;
  const rec = { ts: new Date().toISOString(), level: lvl, name, runId: currentRunId(), msg, ...fields };
  const line = sink || !process.stderr.isTTY
    ? JSON.stringify(rec)
    : `${rec.ts.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${name}  ${msg}`;
  (sink ?? ((l: string) => process.stderr.write(`${l}\n`)))(line);
}
export function createLogger(name: string): Logger {
  return {
    debug: (m, f) => emit(name, 'debug', m, f),
    info: (m, f) => emit(name, 'info', m, f),
    warn: (m, f) => emit(name, 'warn', m, f),
    error: (m, f) => emit(name, 'error', m, f),
  };
}
```

- [ ] **Step 5: Replace representative console calls in chat.ts + run tests**

In `src/cli/chat.ts` add `const log = createLogger('chat');` (import from `../log/logger.ts`) and replace the two status `console.error(...)` at `:191`/`:195` with `log.info(...)`. (Leave the usage-error `console.error` at `:181` — that path exits before a logger is useful; the error boundary in Task 5 handles top-level errors.)

Run: `bun test tests/log/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/log/logger.ts tests/log/logger.test.ts src/telemetry/run-router.ts src/cli/chat.ts
git commit -m "feat(log): structured leveled logger stamped with run-id (replaces ad-hoc console.* status)"
```

---

