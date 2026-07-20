import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import type { JobKind } from '../queue/types.ts';
import { JOBS_DB_MIGRATIONS } from './migrations.ts';
import {
  type Trigger,
  type TriggerConfig,
  type TriggerFiring,
  type TriggerInput,
  TriggerOrigin,
  type TriggerOutcome,
  type TriggerStoreDeps,
  type TriggerType,
} from './types.ts';

type TriggerRowRaw = {
  id: string;
  name: string;
  type: string;
  enabled: number;
  target_kind: string;
  target_payload: string;
  config: string;
  origin: string;
  next_run_at: number | null;
  last_fired_at: number | null;
  token_hash: string | null;
  secret_ref: string | null;
  created_at: number;
  updated_at: number;
};

type FiringRowRaw = {
  id: string;
  trigger_id: string;
  fired_at: number;
  job_id: string | null;
  run_id: string | null;
  outcome: string;
};

function toTrigger(r: TriggerRowRaw): Trigger {
  return {
    id: r.id,
    name: r.name,
    type: r.type as TriggerType,
    enabled: r.enabled !== 0,
    target: {
      kind: r.target_kind as JobKind,
      payload: JSON.parse(r.target_payload) as unknown,
    },
    config: JSON.parse(r.config) as TriggerConfig,
    origin: r.origin as TriggerOrigin,
    nextRunAt: r.next_run_at ?? undefined,
    lastFiredAt: r.last_fired_at ?? undefined,
    secretRef: r.secret_ref ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toFiring(r: FiringRowRaw): TriggerFiring {
  return {
    id: r.id,
    triggerId: r.trigger_id,
    firedAt: r.fired_at,
    jobId: r.job_id ?? undefined,
    runId: r.run_id ?? undefined,
    outcome: r.outcome as TriggerOutcome,
  };
}

function newId(
  prefix: string,
  now = Date.now(),
  rand: () => number = Math.random,
): string {
  const ms = Math.floor(now).toString(36).padStart(9, '0');
  const r = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${prefix}-${ms}-${r}`;
}

function encodeFiringCursor(firedAt: number, id: string): string {
  return Buffer.from(`${firedAt}:${id}`).toString('base64url');
}

function decodeFiringCursor(
  cursor: string,
): { firedAt: number; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return undefined;
    const firedAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(firedAt) || id.length === 0) return undefined;
    return { firedAt, id };
  } catch {
    return undefined;
  }
}

export function createTriggerStore(
  config: { path?: string },
  _deps: TriggerStoreDeps = {},
) {
  // Open jobs.db EXACTLY as createJobStore does (same file, same pragmas), then
  // run the JOBS_DB_MIGRATIONS superset — never TRIGGER_MIGRATIONS alone, or a
  // job-store-first open would have advanced user_version past this list and
  // silently create no tables (see migrations.ts rationale).
  const dbPath = join(config.path ?? 'jobs', 'jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db, JOBS_DB_MIGRATIONS);

  function get(id: string): Trigger | undefined {
    const r = db.query('SELECT * FROM triggers WHERE id = ?').get(id) as
      | TriggerRowRaw
      | undefined;
    return r ? toTrigger(r) : undefined;
  }

  function getByName(name: string, origin: TriggerOrigin): Trigger | undefined {
    const r = db
      .query('SELECT * FROM triggers WHERE name = ? AND origin = ?')
      .get(name, origin) as TriggerRowRaw | undefined;
    return r ? toTrigger(r) : undefined;
  }

  function getByTokenHash(tokenHash: string): Trigger | undefined {
    const r = db
      .query('SELECT * FROM triggers WHERE token_hash = ?')
      .get(tokenHash) as TriggerRowRaw | undefined;
    return r ? toTrigger(r) : undefined;
  }

  function list(): Trigger[] {
    const rows = db
      .query('SELECT * FROM triggers ORDER BY created_at DESC, id ASC')
      .all() as TriggerRowRaw[];
    return rows.map(toTrigger);
  }

  function listByOrigin(origin: TriggerOrigin): Trigger[] {
    const rows = db
      .query(
        'SELECT * FROM triggers WHERE origin = ? ORDER BY created_at DESC, id ASC',
      )
      .all(origin) as TriggerRowRaw[];
    return rows.map(toTrigger);
  }

  function create(
    input: TriggerInput,
    extra?: { tokenHash?: string },
  ): Trigger {
    const at = Date.now();
    const id = newId('trig', at);
    // `enabled` defaults to ON: only an explicit `false` stores 0 (mirrors the
    // migration column default and the console's opt-out pause semantics).
    const enabled = input.enabled === false ? 0 : 1;
    db.run(
      `INSERT INTO triggers
       (id, name, type, enabled, target_kind, target_payload, config, origin,
        next_run_at, last_fired_at, token_hash, secret_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.type,
        enabled,
        input.target.kind,
        JSON.stringify(input.target.payload),
        JSON.stringify(input.config),
        input.origin,
        input.nextRunAt ?? null,
        extra?.tokenHash ?? null,
        input.secretRef ?? null,
        at,
        at,
      ],
    );
    const row = get(id);
    if (!row) throw new Error('create failed to persist trigger');
    return row;
  }

  function update(
    id: string,
    patch: Partial<
      Pick<
        Trigger,
        'enabled' | 'target' | 'config' | 'nextRunAt' | 'lastFiredAt'
      >
    >,
  ): Trigger | undefined {
    if (!get(id)) return undefined;
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if ('enabled' in patch) {
      sets.push('enabled = ?');
      args.push(patch.enabled ? 1 : 0);
    }
    if ('target' in patch && patch.target) {
      sets.push('target_kind = ?', 'target_payload = ?');
      args.push(patch.target.kind, JSON.stringify(patch.target.payload));
    }
    if ('config' in patch && patch.config) {
      sets.push('config = ?');
      args.push(JSON.stringify(patch.config));
    }
    if ('nextRunAt' in patch) {
      sets.push('next_run_at = ?');
      args.push(patch.nextRunAt ?? null);
    }
    if ('lastFiredAt' in patch) {
      sets.push('last_fired_at = ?');
      args.push(patch.lastFiredAt ?? null);
    }
    sets.push('updated_at = ?');
    args.push(Date.now());
    args.push(id);
    db.run(`UPDATE triggers SET ${sets.join(', ')} WHERE id = ?`, args);
    return get(id);
  }

  function remove(id: string): void {
    db.run('DELETE FROM triggers WHERE id = ?', [id]);
  }

  function claimDueCron(
    now: number,
    computeNext: (t: Trigger) => number | null,
  ): Trigger[] {
    // BEGIN IMMEDIATE (.immediate()) takes the write lock at BEGIN — same idiom
    // as JobStore.claimNext (src/queue/store.ts:174). Selecting the due rows and
    // advancing their next_run_at happen in ONE critical section, so a second
    // tick (or a racing caller) can never read the same row as still-due: by the
    // time it runs, next_run_at is already the NEXT future occurrence. Combined
    // with the daemon's double-start pid guard (daemon/core.ts:101), this is the
    // two-lock defense against double-fire (§7.2). bun:sqlite is synchronous, so
    // the transaction body is yield-free.
    const claim = db.transaction((): Trigger[] => {
      const rows = db
        .query(
          `SELECT * FROM triggers
           WHERE enabled = 1 AND type = 'cron'
             AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC, id ASC`,
        )
        .all(now) as TriggerRowRaw[];
      const claimed = rows.map(toTrigger);
      const at = now;
      for (const t of claimed) {
        // computeNext is injected (scheduler owns Croner) but CALLED INSIDE the
        // transaction so the advance is atomic with the select. A null next
        // (unparseable cron — should never reach here) parks the row by nulling
        // next_run_at so it stops being claimed rather than looping every tick.
        // M5: the claim advances next_run_at ONLY — it does NOT touch
        // last_fired_at. "Last fired" means an actual Fired outcome, which is
        // recorded by fire.ts (`update(id, { lastFiredAt })`) AFTER the enqueue
        // succeeds; a claim that then skips (overlap) or fails (chain cap) must
        // NOT report a last-fired time.
        const next = computeNext(t);
        db.run(
          `UPDATE triggers SET next_run_at = ?, updated_at = ?
           WHERE id = ?`,
          [next, at, t.id],
        );
      }
      return claimed;
    });
    return claim.immediate();
  }

  function recordFiring(firing: Omit<TriggerFiring, 'id'>): TriggerFiring {
    const id = newId('f');
    db.run(
      `INSERT INTO trigger_firings
       (id, trigger_id, fired_at, job_id, run_id, outcome)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        firing.triggerId,
        firing.firedAt,
        firing.jobId ?? null,
        firing.runId ?? null,
        firing.outcome,
      ],
    );
    return { id, ...firing };
  }

  function listFirings(
    triggerId: string,
    q: { cursor?: string; limit: number },
  ): { items: TriggerFiring[]; nextCursor?: string; total: number } {
    const totalRow = db
      .query('SELECT COUNT(*) as n FROM trigger_firings WHERE trigger_id = ?')
      .get(triggerId) as { n: number };

    // Keyset on (fired_at DESC, id ASC) — the stable descending idiom of
    // listJobs, on fired_at. id ASC breaks ties at equal fired_at so a page
    // boundary landing between same-timestamp rows never skips or repeats one.
    const cursor = q.cursor ? decodeFiringCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? 'AND (fired_at < ? OR (fired_at = ? AND id > ?))'
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.firedAt, cursor.firedAt, cursor.id]
      : [];

    const rows = db
      .query(
        `SELECT * FROM trigger_firings WHERE trigger_id = ? ${cursorClause}
         ORDER BY fired_at DESC, id ASC LIMIT ?`,
      )
      .all(triggerId, ...cursorArgs, q.limit + 1) as FiringRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items = page.map(toFiring);
    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeFiringCursor(lastRaw.fired_at, lastRaw.id)
        : undefined;
    return { items, nextCursor, total: totalRow.n };
  }

  function latestFiring(triggerId: string): TriggerFiring | undefined {
    const r = db
      .query(
        `SELECT * FROM trigger_firings WHERE trigger_id = ?
         ORDER BY fired_at DESC, id ASC LIMIT 1`,
      )
      .get(triggerId) as FiringRowRaw | undefined;
    return r ? toFiring(r) : undefined;
  }

  function upsertRepo(input: TriggerInput): Trigger {
    // Upsert by (name, origin=repo). When the row already exists, UPDATE the
    // DEFINITION columns (type/target/config/secret_ref) but NEVER enabled, id,
    // or next_run_at — so the operator's console pause/resume overlay and the
    // scheduler's advanced next-run survive a repo re-sync (Task requirement).
    const existing = getByName(input.name, TriggerOrigin.Repo);
    if (existing) {
      const at = Date.now();
      db.run(
        `UPDATE triggers SET type = ?, target_kind = ?, target_payload = ?,
         config = ?, secret_ref = ?, updated_at = ? WHERE id = ?`,
        [
          input.type,
          input.target.kind,
          JSON.stringify(input.target.payload),
          JSON.stringify(input.config),
          input.secretRef ?? null,
          at,
          existing.id,
        ],
      );
      const row = get(existing.id);
      if (!row) throw new Error('upsertRepo failed to persist trigger');
      return row;
    }
    return create({ ...input, origin: TriggerOrigin.Repo });
  }

  function pruneRepo(keepNames: string[]): void {
    // Delete repo-origin rows whose name is no longer defined. Empty keep-set =>
    // prune ALL repo rows (an empty NOT IN would match nothing, so special-case).
    if (keepNames.length === 0) {
      db.run('DELETE FROM triggers WHERE origin = ?', [TriggerOrigin.Repo]);
      return;
    }
    const placeholders = keepNames.map(() => '?').join(', ');
    db.run(
      `DELETE FROM triggers WHERE origin = ? AND name NOT IN (${placeholders})`,
      [TriggerOrigin.Repo, ...keepNames],
    );
  }

  return {
    create,
    get,
    getByName,
    getByTokenHash,
    list,
    listByOrigin,
    update,
    remove,
    claimDueCron,
    recordFiring,
    listFirings,
    latestFiring,
    upsertRepo,
    pruneRepo,
    close: (): void => db.close(),
  };
}

export type TriggerStore = ReturnType<typeof createTriggerStore>;
