import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import type { WorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind } from '../../src/queue/types.ts';
import { createRealRunChatTurn } from '../../src/server/chat/run-turn.ts';
import { startWebServer } from '../../src/server/main.ts';

/** Standalone mode: with no injected queue, startWebServer self-hosts a real
 *  jobStore + worker pool. The enqueued job is parked in the future so the
 *  self-hosted pool never claims/executes it (no model touched). */
test('standalone startWebServer self-hosts a jobStore + pool that enqueues and reports activeCount', async () => {
  const prev = process.env.AGENT_QUEUE_PATH;
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'queue-boot-'));
  const authDir = mkdtempSync(join(tmpdir(), 'queue-boot-auth-'));
  const handle = startWebServer({
    port: 0,
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
  });
  try {
    const rec = handle.jobStore.enqueue({
      kind: JobKind.Chat,
      payload: { task: 'never-run' },
      availableAt: Date.now() + 1_000_000_000, // parked far in the future
    });
    expect(rec.id).toBeTruthy();
    // Persisted durably: a fresh read returns the same row.
    expect(handle.jobStore.getJob(rec.id)?.id).toBe(rec.id);
    // The pool is wired and its introspection is callable.
    expect(typeof handle.pool.activeCount()).toBe('number');
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
    if (prev === undefined) delete process.env.AGENT_QUEUE_PATH;
    else process.env.AGENT_QUEUE_PATH = prev;
  }
});

/** Injected mode (the §7.3 C1 double-pool fix): when the caller passes a
 *  pre-reconciled { jobStore, pool }, startWebServer MUST reuse those exact
 *  instances and MUST NOT start/stop the pool — the caller (the daemon) owns
 *  the lifecycle. Running a second pool on the same DB would double concurrency
 *  and bypass the boot-recovery order. */
test('injected startWebServer reuses the caller pool + store and never starts a second pool', async () => {
  const queuePath = mkdtempSync(join(tmpdir(), 'queue-inject-'));
  const jobStore = createJobStore({ path: queuePath }, {});
  let startCalls = 0;
  let stopCalls = 0;
  const pool: WorkerPool = {
    start: () => {
      startCalls += 1;
    },
    stop: async () => {
      stopCalls += 1;
    },
    cancel: () => false,
    activeCount: () => 0,
  };

  const authDir = mkdtempSync(join(tmpdir(), 'queue-inject-auth-'));
  const handle = startWebServer({
    port: 0,
    queue: { jobStore, pool, concurrency: 3 },
    rootTokenPath: join(authDir, 'daemon-token'),
    sessionRevocationPath: join(authDir, 'revoked-devices.json'),
  });
  try {
    // The SAME instances flow back out — no self-hosted duplicates.
    expect(handle.pool).toBe(pool);
    expect(handle.jobStore).toBe(jobStore);
    // The caller owns lifecycle: startWebServer never touched start()/stop().
    expect(startCalls).toBe(0);
    expect(stopCalls).toBe(0);
  } finally {
    handle.server.stop(true);
    jobStore.close();
  }
});

/** Chat-runId seam (carried from T16): the queue mints a job.runId up front and
 *  returns it as 202 {runId}; the chat execution MUST create its run dir under
 *  THAT id (not a self-minted one) or /api/runs/:id/stream polling breaks for
 *  chat jobs. Prove an injected runId reaches the on-disk run dir. The memory
 *  store throws to short-circuit the turn right after the run dir is created,
 *  so no model is ever touched. */
test('createRealRunChatTurn threads an injected runId into the on-disk run dir', async () => {
  const prevMcp = process.env.AGENT_MCP_CONFIG;
  // Point MCP config at a non-existent file so mountAll has zero entries
  // (fast, no network) — loadMcpConfig never throws on a missing file.
  process.env.AGENT_MCP_CONFIG = join(
    mkdtempSync(join(tmpdir(), 'queue-mcp-')),
    'mcp.json',
  );
  const runsRoot = mkdtempSync(join(tmpdir(), 'queue-runs-'));
  const engine = {
    manager: () => ({}) as never,
    registry: async () => [],
    routerNumCtx: () => undefined,
    runsRoot,
  };
  const throwingMemory = {
    recall: async () => {
      throw new Error('stop-after-run-dir');
    },
  } as unknown as MemoryStore;
  const injectedRunId = 'run-injected-chat-0001';
  const turn = createRealRunChatTurn(engine, throwingMemory);
  try {
    await turn({
      task: 'hi',
      events: () => {},
      stream: () => {},
      runId: injectedRunId,
    });
    throw new Error('expected the throwing memory store to abort the turn');
  } catch (err) {
    expect((err as Error).message).toContain('stop-after-run-dir');
  } finally {
    if (prevMcp === undefined) delete process.env.AGENT_MCP_CONFIG;
    else process.env.AGENT_MCP_CONFIG = prevMcp;
  }
  // The run dir is the injected id — job.runId === run dir holds.
  expect(existsSync(join(runsRoot, injectedRunId))).toBe(true);
});
