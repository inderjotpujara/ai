### Task 2: Process supervisor (spawn + health-poll + reuse + stop)

**Files:**
- Create: `src/runtime/process-supervisor.ts`
- Test: `tests/runtime/process-supervisor.test.ts`

**Interfaces:**
- Produces:
```typescript
export type ChildHandle = { pid: number; kill(sig?: NodeJS.Signals): void; onExit(cb: (code: number | null) => void): void };
export type SpawnFn = (cmd: string, args: string[], opts?: { env?: Record<string, string> }) => ChildHandle;
export type SupervisedServer = { baseUrl: string; stop(): Promise<void> };
export type SuperviseDeps = { spawn?: SpawnFn; fetchImpl?: typeof fetch; startTimeoutMs?: number; pollMs?: number };
export type SuperviseCfg = {
  cmd: string; args: string[]; env?: Record<string, string>;
  host: string; port: number; basePath: string; // e.g. '/v1'
  healthPath: string;                            // '/health' | '/v1/models'
  healthOk?: (res: Response) => boolean;         // default: res.ok
};
export function superviseServer(cfg: SuperviseCfg, deps?: SuperviseDeps): Promise<SupervisedServer>;
```
- Behavior: spawn the process, poll `http://host:port{healthPath}` every `pollMs` (default 250) until `healthOk` true or `startTimeoutMs` (default 30000, via `withWallClock`) elapses → on timeout, `kill()` the child and throw `Error('runtime failed to become healthy')`. `baseUrl = http://host:port{basePath}`. `stop()` kills the child (SIGTERM). Default `spawn` uses `Bun.spawn`; default `fetchImpl` is `fetch`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/runtime/process-supervisor.test.ts
import { expect, test } from 'bun:test';
import { superviseServer, type ChildHandle, type SpawnFn } from '../../src/runtime/process-supervisor.ts';

function fakeSpawn(): { spawn: SpawnFn; killed: () => boolean } {
  let wasKilled = false;
  const spawn: SpawnFn = () => ({ pid: 4242, kill: () => { wasKilled = true; }, onExit: () => {} });
  return { spawn, killed: () => wasKilled };
}
const okAfter = (n: number): typeof fetch => {
  let calls = 0;
  return (async () => { calls++; return new Response('', { status: calls >= n ? 200 : 503 }); }) as unknown as typeof fetch;
};

test('spawns, polls health, resolves a baseUrl', async () => {
  const { spawn } = fakeSpawn();
  const s = await superviseServer(
    { cmd: 'x', args: [], host: '127.0.0.1', port: 9999, basePath: '/v1', healthPath: '/health' },
    { spawn, fetchImpl: okAfter(2), pollMs: 0, startTimeoutMs: 5000 },
  );
  expect(s.baseUrl).toBe('http://127.0.0.1:9999/v1');
});

test('kills the child and throws when health never comes up', async () => {
  const { spawn, killed } = fakeSpawn();
  const never = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  await expect(
    superviseServer(
      { cmd: 'x', args: [], host: '127.0.0.1', port: 9999, basePath: '/v1', healthPath: '/health' },
      { spawn, fetchImpl: never, pollMs: 0, startTimeoutMs: 30 },
    ),
  ).rejects.toThrow('healthy');
  expect(killed()).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/runtime/process-supervisor.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/runtime/process-supervisor.ts` per the Interfaces block. Poll loop: `while (!timedOut) { try { const r = await fetchImpl(url, {signal: AbortSignal.timeout(pollMs+1000)}); if (healthOk(r)) return server; } catch {} await sleep(pollMs); }`. Wrap the whole poll in `withWallClock(startTimeoutMs, ...)`; on the wall-clock reject, `child.kill('SIGTERM')` and rethrow as `Error('runtime failed to become healthy after ${startTimeoutMs}ms')`. Default `spawn`:
```typescript
const defaultSpawn: SpawnFn = (cmd, args, opts) => {
  const proc = Bun.spawn([cmd, ...args], { env: { ...process.env, ...opts?.env }, stdout: 'ignore', stderr: 'ignore' });
  return { pid: proc.pid, kill: (sig) => proc.kill(sig as never), onExit: (cb) => { proc.exited.then((code) => cb(code)); } };
};
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: commit** (`git add` the two files; `feat(runtime): process supervisor with health-poll + kill-on-timeout`).

---

