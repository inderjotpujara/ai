import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogSink } from '../../src/log/logger.ts';
import { JobKind } from '../../src/queue/types.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { syncRepoTriggers } from '../../src/triggers/sync.ts';
import { TriggerOrigin, TriggerType } from '../../src/triggers/types.ts';
import type { TriggerDef } from '../../triggers/index.ts';

afterEach(() => {
  setLogSink(undefined);
});

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

// T7 carry: a repo-defined webhook can't be server-token-minted (a repo TS
// file must not hold a raw secret), so it must land visibly-disabled rather
// than as a silently-dead "enabled" row that can never actually fire.
test('sync registers a repo webhook def as disabled with a warning', () => {
  const store = openStore();
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));

  const defs: Record<string, TriggerDef> = {
    'repo-hook': {
      name: 'repo-hook',
      type: TriggerType.Webhook,
      target: { kind: JobKind.Chat, payload: {} },
      config: {},
    },
  };

  syncRepoTriggers(store, defs);

  const hook = store.getByName('repo-hook', TriggerOrigin.Repo);
  expect(hook).toBeDefined();
  expect(hook?.enabled).toBe(false);

  const records = lines.map((l) => JSON.parse(l));
  const warning = records.find(
    (r) => r.msg === 'trigger.sync.webhook-unsupported',
  );
  expect(warning).toBeDefined();
  expect(warning?.triggerName).toBe('repo-hook');
  // The collision this guards against: `name` is the logger's own SOURCE
  // field (stamped by `createLogger('triggers.sync')` in emit()), so it must
  // never be overwritten by the trigger's name.
  expect(warning?.name).toBe('triggers.sync');

  store.close();
});
