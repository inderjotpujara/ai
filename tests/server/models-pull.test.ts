import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import { handleModelPull } from '../../src/server/models/pull.ts';

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'modelpull-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function tempStore() {
  return createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'modelpull-jobs-')) },
    {},
  );
}

function pullReq(body: unknown): Request {
  return new Request('http://localhost/api/models/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, ENQUEUES a pull job with the resolved ProviderKind', async () => {
  await withRoot(async (runsRoot) => {
    const jobStore = tempStore();
    const res = await handleModelPull(
      pullReq({
        runtime: RuntimeKind.MlxServer,
        modelRef: 'mlx-community/Qwen3.5-30B',
      }),
      {
        runsRoot,
        jobStore,
        resolveProvider: () => ProviderKind.HfSnapshot,
      },
    );
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: string };
    expect(runId.startsWith('run-')).toBe(true);
    expect(existsSync(join(runsRoot, runId))).toBe(true);

    const { items } = jobStore.listJobs({ limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe(JobKind.Pull);
    expect(items[0]?.status).toBe(JobStatus.Queued);
    expect(items[0]?.runId).toBe(runId); // job.runId === run dir id
    expect(items[0]?.payload).toEqual({
      runtime: RuntimeKind.MlxServer,
      modelRef: 'mlx-community/Qwen3.5-30B',
      provider: ProviderKind.HfSnapshot, // resolved SERVER-SIDE, embedded in the payload
    });
    jobStore.close();
  });
});

test('unresolvable (runtime, modelRef) → 404, no dir created, nothing enqueued', async () => {
  await withRoot(async (runsRoot) => {
    const jobStore = tempStore();
    const res = await handleModelPull(
      pullReq({ runtime: RuntimeKind.Ollama, modelRef: 'no-such-model' }),
      { runsRoot, jobStore, resolveProvider: () => undefined },
    );
    expect(res.status).toBe(404);
    expect(jobStore.listJobs({ limit: 10 }).items).toHaveLength(0);
    jobStore.close();
  });
});

test('malformed body → 400 (nothing enqueued)', async () => {
  await withRoot(async (runsRoot) => {
    const jobStore = tempStore();
    const res = await handleModelPull(pullReq({ wrong: 1 }), {
      runsRoot,
      jobStore,
      resolveProvider: () => ProviderKind.Ollama,
    });
    expect(res.status).toBe(400);
    expect(jobStore.listJobs({ limit: 10 }).items).toHaveLength(0);
    jobStore.close();
  });
});
