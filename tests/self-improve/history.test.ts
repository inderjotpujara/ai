import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/db/migrate.ts';
import { JOB_MIGRATIONS } from '../../src/queue/migrations.ts';
import {
  createEvalHistoryStore,
  type EvalHistoryRow,
} from '../../src/self-improve/history.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'eh-'));
const row = (o: Partial<EvalHistoryRow>): EvalHistoryRow => ({
  id: crypto.randomUUID(),
  artifactId: 'a',
  model: 'B:7b',
  ts: 1,
  passed: true,
  passedCount: 3,
  total: 3,
  regressed: false,
  perCase: [],
  judgeModel: 'J:32b',
  belowBar: false,
  ...o,
});

test('insert + listByArtifact returns rows newest-first (ts DESC)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1 }));
  s.insert(row({ ts: 3 }));
  s.insert(row({ ts: 2 }));
  expect(s.listByArtifact('a').map((r) => r.ts)).toEqual([3, 2, 1]);
  s.close();
});

test('latestPassing skips regressed/failed rows and returns the newest passing', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ ts: 1, passed: true }));
  s.insert(row({ ts: 2, passed: false, regressed: true }));
  expect(s.latestPassing('a')?.ts).toBe(1);
  s.close();
});

test('perCase round-trips through the TEXT JSON column', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(
    row({
      perCase: [{ id: 'c0', passed: false, detail: 'judge answered no' }],
    }),
  );
  expect(s.listByArtifact('a')[0]?.perCase[0]).toMatchObject({
    id: 'c0',
    passed: false,
  });
  s.close();
});

test('baselineModel and reason round-trip when present, and are undefined (not null) when absent', () => {
  const s = createEvalHistoryStore({ path: dir() });
  s.insert(row({ id: 'x', baselineModel: 'B:7b', reason: 'below bar' }));
  s.insert(row({ id: 'y', ts: 2 }));
  const [newest, oldest] = s.listByArtifact('a');
  expect(newest?.baselineModel).toBeUndefined();
  expect(newest?.reason).toBeUndefined();
  expect(oldest?.baselineModel).toBe('B:7b');
  expect(oldest?.reason).toBe('below bar');
  s.close();
});

test('the store has no update/delete surface (append-only, §7.4)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  expect((s as Record<string, unknown>).update).toBeUndefined();
  expect((s as Record<string, unknown>).delete).toBeUndefined();
  s.close();
});

test('listByArtifact returns [] for an unknown artifact (absent data tolerated, never throws)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  expect(s.listByArtifact('does-not-exist')).toEqual([]);
  s.close();
});

test('latestPassing returns undefined for an unknown artifact (absent data tolerated, never throws)', () => {
  const s = createEvalHistoryStore({ path: dir() });
  expect(s.latestPassing('does-not-exist')).toBeUndefined();
  s.close();
});

test('R3: a jobs.db already advanced past JOB_MIGRATIONS by the job store still gets eval_history when opened by the eval store', () => {
  // Simulate createJobStore having opened this exact jobs.db file FIRST, so
  // user_version is already at JOB_MIGRATIONS.length before the eval store
  // ever touches it.
  const path = dir();
  const dbPath = join(path, 'jobs.db');
  const pre = new Database(dbPath);
  migrate(pre, JOB_MIGRATIONS);
  pre.close();

  const s = createEvalHistoryStore({ path });
  expect(() => s.insert(row({}))).not.toThrow();
  expect(s.listByArtifact('a')).toHaveLength(1);

  const verify = new Database(dbPath);
  const tables = (
    verify.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  expect(tables).toContain('jobs');
  expect(tables).toContain('eval_history');
  verify.close();
  s.close();
});

test('an absent directory is created on open (no pre-existing jobs.db required)', () => {
  const path = join(dir(), 'nested', 'deeper');
  expect(() => createEvalHistoryStore({ path }).close()).not.toThrow();
});
