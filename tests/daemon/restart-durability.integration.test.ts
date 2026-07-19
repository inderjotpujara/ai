/**
 * §7.3 restart-durability gate (Slice 24, Increment 6, Task 43): the executable
 * proof that a crash-and-restart never double-executes work.
 *
 * Test 1 (the brief's gate, verbatim shape): two orphaned Running rows — one
 * durable crew, one non-durable chat — survive a "crash"; the restarted daemon
 * reconciles (durable → re-queued, non-durable → Interrupted) BEFORE the pool
 * starts, and a per-runId dispatch counter proves at-most-once execution.
 *
 * Test 2 (mid-DAG crash + checkpoint resume, end-to-end): a durable workflow
 * job executes PART of its DAG (node `a` completes and is checkpointed to
 * runs/<runId>/checkpoint.json), the process "dies" mid-node-`b`, and a NEW
 * daemon over the SAME store + runs dir resumes it. The per-node side-effect
 * counter is the headline assertion: node `a` ran EXACTLY ONCE across both the
 * pre-crash and post-restart passes.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createDaemon } from '../../src/daemon/core.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, type JobRecord, JobStatus } from '../../src/queue/types.ts';
import { createCheckpointStore } from '../../src/workflow/checkpoint.ts';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind } from '../../src/workflow/types.ts';

const waitFor = async (p: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (p()) return;
    await Bun.sleep(10);
  }
  throw new Error('timeout waiting for condition');
};

test('restart resumes durable orphans at-most-once; non-durable → Interrupted; no double-exec', async () => {
  const store = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
    {},
  );
  // Two orphaned Running rows (simulate a crash mid-flight).
  const crew = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const chat = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext(); // crew -> Running
  store.claimNext(); // chat -> Running

  // Dispatch counts executions per runId — proves at-most-once.
  const execs = new Map<string, number>();
  const pool = createWorkerPool({
    store,
    concurrency: 2,
    pollMs: 5,
    dispatch: () => async (job) => {
      const key = job.runId as string;
      execs.set(key, (execs.get(key) ?? 0) + 1);
      return { ok: true };
    },
  });
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: (() => ({
      server: { stop() {} },
      token: 't',
      port: 0,
    })) as never,
    queue: store,
    pool,
    pidPath,
    installSignals: () => {},
    // Incr-6 wiring: the daemon reconciles with the durable predicate BEFORE
    // the pool starts, so durable orphans requeue and non-durable ones interrupt.
    durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow,
  });

  await daemon.start(); // reconcile(durable) → pool.start (the §7.3 ordering)
  // The durable crew orphan was requeued and re-dispatched EXACTLY once.
  await waitFor(() => store.getJob(crew.id)?.status === JobStatus.Done);
  expect(execs.get(crew.runId as string)).toBe(1);
  // The non-durable chat orphan was interrupted and never auto-re-run.
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Interrupted);
  expect(execs.has(chat.runId as string)).toBe(false);

  await daemon.stop();
  store.close();
});

test('mid-DAG crash: restart resumes from checkpoint — node a executes EXACTLY once across the crash boundary', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'runs-'));
  const store = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
    {},
  );

  // Linear DAG a→b→c. Each node's body bumps a side-effect counter, so we can
  // assert exactly how many times each node executed across BOTH passes.
  const def = defineWorkflow({
    id: 'restart-flow',
    steps: [
      {
        id: 'a',
        kind: StepKind.Agent,
        agent: 'a',
        input: () => 'a',
        output: z.string(),
      },
      {
        id: 'b',
        kind: StepKind.Agent,
        agent: 'b',
        input: (ctx) => `after ${ctx.a}`,
        output: z.string(),
      },
      {
        id: 'c',
        kind: StepKind.Agent,
        agent: 'c',
        input: (ctx) => `after ${ctx.b}`,
        output: z.string(),
      },
    ],
  });

  const counts: Record<string, number> = {};
  let crashed = true;

  // The REAL dispatch seam a durable job runs through: runWorkflow with the
  // per-run checkpoint at runs/<runId> — identical pre-crash and post-restart.
  const workflowExecutor = async (job: JobRecord): Promise<unknown> => {
    const checkpoint = createCheckpointStore(
      join(runsRoot, job.runId as string),
    );
    const out = await runWorkflow(def, 'go', {
      tools: {},
      runAgentStep: async (name) => {
        // The "kill": pre-crash, the process dies as node b starts — BEFORE b
        // does any observable work (its counter is not bumped), exactly like a
        // SIGKILL mid-node. Node a already completed and checkpointed.
        if (name === 'b' && crashed) throw new Error('simulated process death');
        counts[name] = (counts[name] ?? 0) + 1;
        return name.toUpperCase();
      },
      checkpoint,
    });
    if (out.kind !== 'done') throw new Error(`workflow ${out.kind}`);
    return out.output;
  };

  // ---- Pass 1: the pre-crash daemon ----
  const wf = store.enqueue({ kind: JobKind.Workflow, payload: { flow: 1 } });
  const claimed = store.claimNext(); // wf -> Running (the old daemon claimed it)
  expect(claimed?.id).toBe(wf.id);
  const chat = store.enqueue({ kind: JobKind.Chat, payload: 'hi' });
  store.claimNext(); // chat -> Running (a non-durable orphan too)

  // The old process executes PART of the DAG, then "dies": node a completes
  // (checkpoint written durably), b is killed mid-start, c is never reached.
  // Crucially NO terminal write happens — the row is left Running, the §7.3
  // orphan a hard crash leaves behind.
  await expect(workflowExecutor(claimed as JobRecord)).rejects.toThrow(
    'workflow failed',
  );
  expect(counts).toEqual({ a: 1 });
  expect(
    createCheckpointStore(join(runsRoot, wf.runId as string)).completed(),
  ).toEqual(new Set(['a']));
  expect(store.getJob(wf.id)?.status).toBe(JobStatus.Running);
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Running);

  // ---- Pass 2: "restart" — a NEW pool + daemon over the SAME store + runs dir ----
  crashed = false;
  const dispatches: string[] = []; // every job id the new pool hands to an executor
  const chatExecs: string[] = [];
  const pool = createWorkerPool({
    store,
    concurrency: 2,
    pollMs: 5,
    dispatch: (kind) => async (job) => {
      dispatches.push(job.id);
      if (kind === JobKind.Chat) {
        chatExecs.push(job.id);
        return {};
      }
      return workflowExecutor(job);
    },
  });
  // Instrument reconcile + pool.start to prove the reconcile-before-claim
  // ordering: reconcile runs first, and NOTHING has been dispatched by then.
  const order: string[] = [];
  let dispatchesAtReconcile = -1;
  let reconcileResult: { interrupted: number; requeued: number } | undefined;
  const wrappedPool = {
    ...pool,
    start: (): void => {
      order.push('pool.start');
      pool.start();
    },
  };
  const wrappedStore = {
    ...store,
    reconcileOrphans: (opts?: {
      durable?: (job: JobRecord) => boolean;
    }): { interrupted: number; requeued: number } => {
      order.push('reconcile');
      dispatchesAtReconcile = dispatches.length;
      reconcileResult = store.reconcileOrphans(opts);
      return reconcileResult;
    },
  };
  const pidPath = join(mkdtempSync(join(tmpdir(), 'pid-')), 'daemon.pid');
  const daemon = createDaemon({
    startWebServer: (() => ({
      server: { stop() {} },
      token: 't',
      port: 0,
    })) as never,
    queue: wrappedStore,
    pool: wrappedPool,
    pidPath,
    installSignals: () => {},
    durable: (j) => j.kind === JobKind.Crew || j.kind === JobKind.Workflow,
  });

  await daemon.start();
  await waitFor(() => store.getJob(wf.id)?.status === JobStatus.Done);

  // HEADLINE (§7.3): node a's side-effect ran EXACTLY ONCE across the crash
  // boundary — resume seeded it from the checkpoint instead of re-executing.
  expect(counts.a).toBe(1);
  // The remaining nodes executed exactly once (post-restart only) → Done.
  expect(counts).toEqual({ a: 1, b: 1, c: 1 });
  // a's VALUE in the final result came from the checkpoint, not a re-run.
  expect(store.getJob(wf.id)?.result).toMatchObject({
    a: 'A',
    b: 'B',
    c: 'C',
  });
  // At-most-once at the dispatch level: the durable job was handed to an
  // executor exactly once post-restart, and it resumed the SAME runId.
  expect(dispatches).toEqual([wf.id]);
  // Reconcile-before-claim ordering: reconcile ran before the pool started,
  // and no dispatch had happened yet — no claim window before recovery.
  expect(order).toEqual(['reconcile', 'pool.start']);
  expect(dispatchesAtReconcile).toBe(0);
  // Reconcile distinguished the orphans: 1 durable requeued, 1 chat interrupted.
  expect(reconcileResult).toEqual({ interrupted: 1, requeued: 1 });
  // The non-durable chat orphan landed Interrupted and was never auto-re-run.
  expect(store.getJob(chat.id)?.status).toBe(JobStatus.Interrupted);
  expect(chatExecs).toHaveLength(0);

  await daemon.stop();
  store.close();
});
