import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { handleTriggerDetail } from '../../src/server/triggers/detail.ts';
import { handleTriggerFirings } from '../../src/server/triggers/firings.ts';
import { handleTriggerList } from '../../src/server/triggers/list.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';

const deps = () => ({
  triggers: {
    store: createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) }),
  },
});

const cronInput = (name: string) => ({
  name,
  type: TriggerType.Cron,
  origin: TriggerOrigin.Console,
  target: { kind: JobKind.Chat, payload: { task: 'x' } },
  config: { schedule: '* * * * *' },
  enabled: true,
});

test('GET /api/triggers lists projected DTOs without secretRef', async () => {
  const d = deps();
  d.triggers.store.create(cronInput('nightly'), { tokenHash: 'hash-1' });

  const res = handleTriggerList(d as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  expect(body.items.length).toBe(1);
  expect(body.items[0]).not.toHaveProperty('secretRef');
  expect(body.items[0]).not.toHaveProperty('token');
  expect(body.items[0]).not.toHaveProperty('tokenHash');
  expect(body.items[0]?.name).toBe('nightly');
});

test('GET /api/triggers/:id returns the full trigger DTO', async () => {
  const d = deps();
  const t = d.triggers.store.create(cronInput('nightly'));

  const res = handleTriggerDetail(t.id, d as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string };
  expect(body.id).toBe(t.id);
});

test('GET /api/triggers/:id → 404 for an unknown id', () => {
  const d = deps();
  const res = handleTriggerDetail('trig-nope', d as never);
  expect(res.status).toBe(404);
});

test('GET /api/triggers/:id/firings paginates newest-first', async () => {
  const d = deps();
  const t = d.triggers.store.create(cronInput('nightly'));
  d.triggers.store.recordFiring({
    triggerId: t.id,
    firedAt: 100,
    outcome: 'fired' as never,
    jobId: 'job-1',
  });
  d.triggers.store.recordFiring({
    triggerId: t.id,
    firedAt: 200,
    outcome: 'fired' as never,
    jobId: 'job-2',
  });
  d.triggers.store.recordFiring({
    triggerId: t.id,
    firedAt: 300,
    outcome: 'fired' as never,
    jobId: 'job-3',
  });

  const page1 = handleTriggerFirings(
    t.id,
    new URLSearchParams('limit=2'),
    d as never,
  );
  expect(page1.status).toBe(200);
  const body1 = (await page1.json()) as {
    items: { firedAt: number; jobId?: string }[];
    nextCursor?: string;
    total: number;
  };
  expect(body1.total).toBe(3);
  expect(body1.items.map((i) => i.firedAt)).toEqual([300, 200]);
  expect(body1.nextCursor).toBeDefined();

  const page2 = handleTriggerFirings(
    t.id,
    new URLSearchParams(`limit=2&cursor=${body1.nextCursor}`),
    d as never,
  );
  const body2 = (await page2.json()) as {
    items: { firedAt: number }[];
    nextCursor?: string;
  };
  expect(body2.items.map((i) => i.firedAt)).toEqual([100]);
  expect(body2.nextCursor).toBeUndefined();
});

test('GET /api/triggers/:id/firings rejects a bad query with 400', () => {
  const d = deps();
  const t = d.triggers.store.create(cronInput('nightly'));
  const res = handleTriggerFirings(
    t.id,
    new URLSearchParams('limit=not-a-number-and-negative'),
    d as never,
  );
  // limit is z.coerce.number() — a non-numeric string coerces to NaN, which
  // fails .positive(), so this is a 400 not a 500/NaN-limit crash.
  expect(res.status).toBe(400);
});
