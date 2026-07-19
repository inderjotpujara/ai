import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { maxAttempts as defaultMaxAttempts } from '../reliability/config.ts';
import { newRunId } from '../run/run-id.ts';
import { JOB_MIGRATIONS } from './migrations.ts';
import {
  type JobInput,
  type JobKind,
  JobPriority,
  type JobRecord,
  type JobStatus,
} from './types.ts';

type JobRowRaw = {
  id: string;
  kind: string;
  payload: string;
  priority: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  available_at: number;
  run_id: string | null;
  result: string | null;
  error: string | null;
};

function toJobRecord(r: JobRowRaw): JobRecord {
  return {
    id: r.id,
    kind: r.kind as JobKind,
    payload: JSON.parse(r.payload) as unknown,
    priority: r.priority as JobPriority,
    status: r.status as JobStatus,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    availableAt: r.available_at,
    runId: r.run_id ?? undefined,
    result: r.result === null ? undefined : (JSON.parse(r.result) as unknown),
    error: r.error ?? undefined,
  };
}

function encodeJobCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`).toString('base64url');
}

function decodeJobCursor(
  cursor: string,
): { createdAt: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const createdAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(createdAt) || id.length === 0) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

function newJobId(now = Date.now(), rand: () => number = Math.random): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `job-${ms}-${r}`;
}

/** Parity seam mirroring `SessionStoreDeps` (`src/session/store.ts:102`). */
export type JobStoreDeps = Record<string, never>;

export function createJobStore(config: { path?: string }, _deps: JobStoreDeps) {
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOB_MIGRATIONS);

  function enqueue(input: JobInput): JobRecord {
    const at = Date.now();
    const id = newJobId(at);
    const runId = input.runId ?? newRunId();
    const priority = input.priority ?? JobPriority.Normal;
    const max = input.maxAttempts ?? defaultMaxAttempts();
    // INSERT OR IGNORE on the PK: a retried enqueue for the SAME id is a safe
    // no-op (mirrors upsertSession's idempotency, src/session/store.ts:130).
    const availableAt = input.availableAt ?? 0; // 0 = immediately claimable
    db.run(
      `INSERT OR IGNORE INTO jobs
       (id, kind, payload, priority, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, available_at,
        run_id, result, error)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
      [
        id,
        input.kind,
        JSON.stringify(input.payload),
        priority,
        max,
        at,
        at,
        availableAt,
        runId,
      ],
    );
    const row = getJob(id);
    if (!row) throw new Error('enqueue failed to persist job');
    return row;
  }

  function getJob(id: string): JobRecord | undefined {
    const r = db.query('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRowRaw
      | undefined;
    return r ? toJobRecord(r) : undefined;
  }

  return {
    enqueue,
    getJob,
    close: (): void => db.close(),
    // claimNext / mark* / listJobs / reconcileOrphans added in Tasks 7-10.
    _db: db,
    _decodeJobCursor: decodeJobCursor,
    _encodeJobCursor: encodeJobCursor,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
