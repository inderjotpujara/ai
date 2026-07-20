import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import {
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

const cronInput = (name: string, next: number) => ({
  name,
  type: TriggerType.Cron,
  origin: TriggerOrigin.Console,
  target: { kind: JobKind.Chat, payload: { task: 'x' } },
  config: { schedule: '* * * * *' },
  nextRunAt: next,
  enabled: true,
});

test('claimDueCron advances next_run_at in one transaction (no double-claim)', () => {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-')),
  });
  const t = store.create(cronInput('due', 100));
  // First claim at now=150 returns the due row and advances it to 9999.
  const first = store.claimDueCron(150, () => 9999);
  expect(first.map((x) => x.id)).toEqual([t.id]);
  // Second claim at the SAME now returns nothing — next_run_at already moved.
  expect(store.claimDueCron(150, () => 9999)).toEqual([]);
  expect(store.get(t.id)?.nextRunAt).toBe(9999);
  // M5: the claim advances next_run_at only — last_fired_at is left untouched
  // (it is set by fire.ts on an actual Fired outcome, not by the claim).
  expect(store.get(t.id)?.lastFiredAt).toBeUndefined();
  store.close();
});

test('upsertRepo preserves the console-set enabled overlay across re-sync', () => {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-')),
  });
  const repo = { ...cronInput('nightly', 100), origin: TriggerOrigin.Repo };
  const created = store.upsertRepo(repo);
  store.update(created.id, { enabled: false }); // operator pauses it
  const again = store.upsertRepo({
    ...repo,
    config: { schedule: '0 4 * * *' },
  });
  expect(again.id).toBe(created.id); // same row
  expect(again.enabled).toBe(false); // overlay survived
  expect((again.config as { schedule: string }).schedule).toBe('0 4 * * *'); // def updated
  store.close();
});

test('firings keyset list is newest-first and paginates', () => {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-')),
  });
  const t = store.create(cronInput('f', 100));
  for (let i = 1; i <= 3; i++) {
    store.recordFiring({
      triggerId: t.id,
      firedAt: i,
      jobId: `j${i}`,
      runId: `r${i}`,
      outcome: TriggerOutcome.Fired,
    });
  }
  const page = store.listFirings(t.id, { limit: 2 });
  expect(page.items.map((f) => f.firedAt)).toEqual([3, 2]);
  expect(page.total).toBe(3);
  expect(store.latestFiring(t.id)?.firedAt).toBe(3);
  store.close();
});

test('firings keyset list page 2 continues from the cursor with no overlap/gap', () => {
  const store = createTriggerStore({
    path: mkdtempSync(join(tmpdir(), 'trg-')),
  });
  const t = store.create(cronInput('f2', 100));
  for (let i = 1; i <= 3; i++) {
    store.recordFiring({
      triggerId: t.id,
      firedAt: i,
      jobId: `j${i}`,
      runId: `r${i}`,
      outcome: TriggerOutcome.Fired,
    });
  }
  const page1 = store.listFirings(t.id, { limit: 2 });
  expect(page1.items.map((f) => f.firedAt)).toEqual([3, 2]);
  expect(page1.nextCursor).toBeDefined();
  expect(page1.total).toBe(3);

  const page2 = store.listFirings(t.id, {
    cursor: page1.nextCursor,
    limit: 2,
  });
  // Only the oldest firing remains, no cursor for a further page, and no
  // overlap with page 1's items.
  expect(page2.items.map((f) => f.firedAt)).toEqual([1]);
  expect(page2.nextCursor).toBeUndefined();
  expect(page2.total).toBe(3);
  const allFiredAt = [...page1.items, ...page2.items].map((f) => f.firedAt);
  expect(allFiredAt).toEqual([3, 2, 1]);
  expect(new Set(allFiredAt).size).toBe(allFiredAt.length);
  store.close();
});
