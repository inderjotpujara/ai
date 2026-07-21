import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobLaunchResponseSchema } from '../../src/contracts/index.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import type { SessionGuard } from '../../src/server/security/token.ts';
import { handleTriggerFire } from '../../src/server/triggers/fire.ts';
import { createFireTrigger } from '../../src/triggers/fire.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';

function deps(maxChainDepth = 5) {
  const dbDir = mkdtempSync(join(tmpdir(), 'trg-fire-db-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'trg-fire-runs-'));
  // TriggerStore first: it runs the JOBS_DB_MIGRATIONS superset (creates BOTH
  // the jobs and triggers tables), same ordering as tests/triggers/fire.test.ts.
  const store = createTriggerStore({ path: dbDir });
  const jobStore = createJobStore({ path: dbDir }, {});
  const fire = createFireTrigger({
    triggerStore: store,
    jobStore,
    runsRoot,
    maxChainDepth: () => maxChainDepth,
  });
  return {
    triggers: { store, fire },
    policy: { port: 4130, allowedOrigins: [], allowedHosts: [] },
    jobStore,
  };
}

const localGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'local',
};
const remoteGuard: SessionGuard = {
  verify: () => true,
  verifyToken: () => true,
  principal: () => 'uuid-remote',
};

function req(path: string, body?: unknown, host = '127.0.0.1:4130'): Request {
  return new Request(`http://127.0.0.1:4130${path}`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const cronTrigger = (
  store: ReturnType<typeof createTriggerStore>,
  opts: { allowOverlap?: boolean } = {},
) =>
  store.create({
    name: `t-${Math.random()}`,
    type: TriggerType.Cron,
    origin: TriggerOrigin.Console,
    target: { kind: JobKind.Chat, payload: { task: 'x' } },
    config: { schedule: '* * * * *', allowOverlap: opts.allowOverlap },
    enabled: true,
  });

test('fire requires trusted-local (403 from a non-loopback principal, zero side effect)', async () => {
  const d = deps();
  const t = cronTrigger(d.triggers.store);
  const res = await handleTriggerFire(
    t.id,
    req(`/api/triggers/${t.id}/fire`),
    d as never,
    remoteGuard,
  );
  expect(res.status).toBe(403);
  expect(d.jobStore.stats().total).toBe(0);
});

test('fire → 404 for an unknown id', async () => {
  const d = deps();
  const res = await handleTriggerFire(
    'trig-nope',
    req('/api/triggers/trig-nope/fire'),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(404);
});

test('fire test-fires immediately: 202 {jobId,runId}, trusted-local gated', async () => {
  const d = deps();
  const t = cronTrigger(d.triggers.store);
  const res = await handleTriggerFire(
    t.id,
    req(`/api/triggers/${t.id}/fire`),
    d as never,
    localGuard,
  );
  expect(res.status).toBe(202);
  const body = JobLaunchResponseSchema.parse(await res.json());
  expect(body.jobId).toBeDefined();
  expect(body.runId).toBeDefined();
  expect(d.jobStore.getJob(body.jobId)).toBeDefined();
});

test('F1: a client-supplied chainDepth in the body is IGNORED — a manual fire always starts a fresh chain', async () => {
  const d = deps(3); // low cap so an accepted client chainDepth would trip it
  const t = cronTrigger(d.triggers.store);
  const res = await handleTriggerFire(
    t.id,
    // An attacker-supplied body trying to smuggle an over-cap chainDepth.
    req(`/api/triggers/${t.id}/fire`, { chainDepth: 999 }),
    d as never,
    localGuard,
  );
  // If chainDepth were read from the body this would 500 (chain-cap Failed).
  // It must fire clean at depth 0 instead.
  expect(res.status).toBe(202);
  const body = JobLaunchResponseSchema.parse(await res.json());
  expect(d.jobStore.getJob(body.jobId)?.chainDepth).toBe(0);
});

test('overlap-bypass: fires even while a prior job from the same trigger is still running', async () => {
  const d = deps();
  const t = cronTrigger(d.triggers.store); // no allowOverlap
  const first = await handleTriggerFire(
    t.id,
    req(`/api/triggers/${t.id}/fire`),
    d as never,
    localGuard,
  );
  expect(first.status).toBe(202);
  const firstBody = JobLaunchResponseSchema.parse(await first.json());
  // Confirm the prior job is still in flight (Queued), the overlap condition.
  expect(d.jobStore.getJob(firstBody.jobId)?.status).toBe(JobStatus.Queued);

  const second = await handleTriggerFire(
    t.id,
    req(`/api/triggers/${t.id}/fire`),
    d as never,
    localGuard,
  );
  expect(second.status).toBe(202);
  const secondBody = JobLaunchResponseSchema.parse(await second.json());
  expect(secondBody.jobId).not.toBe(firstBody.jobId);
});
