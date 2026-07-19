import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import {
  maxAttempts as defaultMaxAttempts,
  retryBaseMs,
  retryCapMs,
} from '../reliability/config.ts';
import { newRunId } from '../run/run-id.ts';
import { JOB_MIGRATIONS } from './migrations.ts';
import {
  type JobInput,
  type JobKind,
  JobPriority,
  type JobRecord,
  type JobStatus,
  type JobStoreDeps,
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

/** Full-jitter exponential backoff (ms) for a re-queued job's `available_at`.
 *  `attempt` is tries USED (claimNext already bumped it). Reuses the reliability
 *  backoff knobs — never a hardcoded delay. */
function backoffDelay(
  attempt: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(
    retryCapMs(),
    retryBaseMs() * 2 ** Math.max(0, attempt - 1),
  );
  const jitter = 0.5 + rand() / 2;
  return Math.floor(jitter * exp);
}

// The claim scan orders by `priority ASC` and relies on the JobPriority enum's
// TEXT values sorting High-before-Normal lexically (see idx_jobs_claim in
// migrations.ts). Assert that intent once, at module load, so a future rename of
// a JobPriority value that silently broke scheduling fails loudly here instead.
if (!(JobPriority.High < JobPriority.Normal)) {
  throw new Error(
    'JobPriority values must sort High-before-Normal lexically for claimNext ordering',
  );
}

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

  function claimNext(now = Date.now()): JobRecord | null {
    // Single transaction: SELECT the winning Queued row then UPDATE it to
    // Running, so two workers calling claimNext concurrently cannot both read
    // the same row as Queued and both claim it. The transaction runs as
    // BEGIN IMMEDIATE (via .immediate() below), which takes the write lock
    // at BEGIN rather than deferring it to the first write — so claimers
    // serialise with no read-then-upgrade window between the SELECT and the
    // UPDATE. The UPDATE's WHERE status='queued' plus the changes-count guard
    // below is the belt-and-suspenders check for the row actually being won.
    // bun:sqlite runs synchronously, so the transaction body is a critical
    // section.
    const claim = db.transaction((): JobRecord | null => {
      // `available_at <= now` gates retry-backoff'd rows: a job re-queued by
      // markFailed with a future available_at is NOT re-claimed until it
      // matures, so backoff actually spaces re-claims under concurrency
      // (the delay is enforced here, durably, not by a worker sleeping).
      // ORDER BY priority ASC uses the enum TEXT ordering (High before Normal;
      // asserted at module load), then created_at ASC for FIFO-by-enqueue-time
      // with id ASC as a stable, deterministic tiebreak (not true insertion
      // order at sub-millisecond resolution) — served by
      // idx_jobs_claim(status, priority, created_at).
      const r = db
        .query(
          `SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ?
           ORDER BY priority ASC, created_at ASC, id ASC LIMIT 1`,
        )
        .get(now) as JobRowRaw | undefined;
      if (!r) return null;
      const res = db.run(
        `UPDATE jobs SET status = 'running', started_at = ?, updated_at = ?,
         attempts = attempts + 1 WHERE id = ? AND status = 'queued'`,
        [now, now, r.id],
      );
      // Someone else claimed this row between our SELECT and UPDATE (should
      // be impossible under IMMEDIATE, but this is the guard that makes the
      // impossible loud instead of silently double-claiming).
      if (res.changes !== 1) return null;
      const claimed = db.query('SELECT * FROM jobs WHERE id = ?').get(r.id) as
        | JobRowRaw
        | undefined;
      return claimed ? toJobRecord(claimed) : null;
    });
    return claim.immediate();
  }

  function markDone(id: string, result: unknown): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'done', result = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(result ?? null), at, at, id],
    );
  }

  function markFailed(id: string, error: string, retryable: boolean): void {
    const at = Date.now();
    const row = getJob(id);
    // Retry if the caller says the error is retryable AND we have attempts left.
    // `attempts` was already bumped by claimNext, so it reflects tries USED.
    const canRetry =
      retryable && row !== undefined && row.attempts < row.maxAttempts;
    if (canRetry) {
      // Persist the backoff as an `available_at` floor so claimNext won't
      // re-claim this row until it matures — the delay is enforced durably in
      // the DB, not by a worker sleeping on a held slot (Task 13).
      const availableAt = at + backoffDelay(row.attempts);
      db.run(
        `UPDATE jobs SET status = 'queued', error = ?, updated_at = ?,
         started_at = NULL, available_at = ? WHERE id = ?`,
        [error, at, availableAt, id],
      );
      return;
    }
    db.run(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [error, at, at, id],
    );
  }

  function markInterrupted(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }

  function markCanceled(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'canceled', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }

  function listJobs(q: {
    status?: JobStatus;
    cursor?: string;
    limit: number;
  }): { items: JobRecord[]; nextCursor?: string; total: number } {
    const statusClause = q.status ? 'AND status = ?' : '';
    const statusArgs: (string | number)[] = q.status ? [q.status] : [];

    const totalRow = db
      .query(`SELECT COUNT(*) as n FROM jobs WHERE 1 = 1 ${statusClause}`)
      .get(...statusArgs) as { n: number };

    const cursor = q.cursor ? decodeJobCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? 'AND (created_at < ? OR (created_at = ? AND id > ?))'
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.createdAt, cursor.createdAt, cursor.id]
      : [];

    const rows = db
      .query(
        `SELECT * FROM jobs WHERE 1 = 1 ${statusClause} ${cursorClause}
         ORDER BY created_at DESC, id ASC LIMIT ?`,
      )
      .all(...statusArgs, ...cursorArgs, q.limit + 1) as JobRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items = page.map(toJobRecord);
    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeJobCursor(lastRaw.created_at, lastRaw.id)
        : undefined;
    return { items, nextCursor, total: totalRow.n };
  }

  return {
    enqueue,
    getJob,
    claimNext,
    markDone,
    markFailed,
    markInterrupted,
    markCanceled,
    listJobs,
    close: (): void => db.close(),
    // reconcileOrphans added in Task 10.
    _db: db,
    _decodeJobCursor: decodeJobCursor,
    _encodeJobCursor: encodeJobCursor,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
