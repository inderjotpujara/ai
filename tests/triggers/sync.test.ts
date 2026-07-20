import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { syncRepoTriggers } from '../../src/triggers/sync.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';
import type { TriggerDef } from '../../triggers/index.ts';

function openStore() {
  return createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-sync-')) });
}

test('sync upserts repo defs and prunes removed ones', () => {
  const store = openStore();
  // Pre-existing repo row 'old' (paused by the operator) that is no longer
  // defined in the repo — sync must prune it.
  const old = store.upsertRepo({
    name: 'old',
    type: TriggerType.Cron,
    origin: TriggerOrigin.Repo,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '* * * * *' },
  });
  store.update(old.id, { enabled: false });

  const defs: Record<string, TriggerDef> = {
    nightly: {
      name: 'nightly',
      type: TriggerType.Cron,
      target: { kind: JobKind.Chat, payload: { task: 'nightly-report' } },
      config: { schedule: '0 2 * * *' },
    },
  };

  syncRepoTriggers(store, defs);

  const nightly = store.getByName('nightly', TriggerOrigin.Repo);
  expect(nightly).toBeDefined();
  expect(nightly?.enabled).toBe(true);
  expect(nightly?.origin).toBe(TriggerOrigin.Repo);

  expect(store.getByName('old', TriggerOrigin.Repo)).toBeUndefined();

  store.close();
});

test('sync preserves the console-paused overlay across re-sync', () => {
  const store = openStore();
  const nightlyDef: TriggerDef = {
    name: 'nightly',
    type: TriggerType.Cron,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '0 2 * * *' },
  };
  syncRepoTriggers(store, { nightly: nightlyDef });
  const created = store.getByName('nightly', TriggerOrigin.Repo);
  expect(created).toBeDefined();
  if (!created) throw new Error('unreachable');
  store.update(created.id, { enabled: false }); // operator pauses it

  // Re-sync with a changed schedule; the pause overlay must survive.
  syncRepoTriggers(store, {
    nightly: { ...nightlyDef, config: { schedule: '0 4 * * *' } },
  });

  const again = store.getByName('nightly', TriggerOrigin.Repo);
  expect(again?.id).toBe(created.id);
  expect(again?.enabled).toBe(false);
  expect((again?.config as { schedule: string }).schedule).toBe('0 4 * * *');

  store.close();
});

// I1(b): a repo cron def with a bad pattern is registered DISABLED, never throws.
test('sync registers a bad-cron repo def as disabled (no throw)', () => {
  const store = openStore();
  const defs: Record<string, TriggerDef> = {
    broken: {
      name: 'broken',
      type: TriggerType.Cron,
      target: { kind: JobKind.Chat, payload: {} },
      config: { schedule: 'not a cron' },
    },
  };

  expect(() => syncRepoTriggers(store, defs)).not.toThrow();

  const broken = store.getByName('broken', TriggerOrigin.Repo);
  expect(broken).toBeDefined();
  expect(broken?.enabled).toBe(false);

  store.close();
});

test('sync leaves non-cron trigger types untouched by cron validation', () => {
  const store = openStore();
  const defs: Record<string, TriggerDef> = {
    'on-file': {
      name: 'on-file',
      type: TriggerType.File,
      target: { kind: JobKind.Chat, payload: {} },
      config: { path: '/tmp/watched' },
    },
  };

  syncRepoTriggers(store, defs);

  const onFile = store.getByName('on-file', TriggerOrigin.Repo);
  expect(onFile).toBeDefined();
  expect(onFile?.enabled).toBe(true);

  store.close();
});
