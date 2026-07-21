### Task 7: Trigger store — CRUD + atomic claimDueCron + firings

**Files:**
- Create: `src/triggers/store.ts`
- Test: `tests/triggers/store.test.ts`

**Interfaces:**
- Consumes: `JOBS_DB_MIGRATIONS` from `./migrations.ts`; `migrate` from `../db/migrate.ts`; all trigger `type`s/enums from `./types.ts`.
- Produces `createTriggerStore(config: { path?: string }): TriggerStore` where:

```ts
export type TriggerStore = {
  create(input: TriggerInput, extra?: { tokenHash?: string }): Trigger;
  get(id: string): Trigger | undefined;
  getByName(name: string, origin: TriggerOrigin): Trigger | undefined;
  getByTokenHash(tokenHash: string): Trigger | undefined;
  list(): Trigger[];
  listByOrigin(origin: TriggerOrigin): Trigger[];
  update(id: string, patch: Partial<Pick<Trigger,
    'enabled' | 'target' | 'config' | 'nextRunAt' | 'lastFiredAt'>>): Trigger | undefined;
  remove(id: string): void;
  /** BEGIN IMMEDIATE claim: select due cron rows AND advance their next_run_at
   *  in ONE transaction, so no tick (or racing caller) re-claims the same row. */
  claimDueCron(now: number, computeNext: (t: Trigger) => number | null): Trigger[];
  recordFiring(firing: Omit<TriggerFiring, 'id'>): TriggerFiring;
  listFirings(triggerId: string, q: { cursor?: string; limit: number }):
    { items: TriggerFiring[]; nextCursor?: string; total: number };
  latestFiring(triggerId: string): TriggerFiring | undefined;
  /** Repo sync: upsert by (name, origin=repo) PRESERVING enabled + id +
   *  next_run_at when the row already exists (the console pause/resume overlay
   *  survives re-sync). */
  upsertRepo(input: TriggerInput): Trigger;
  /** Delete repo rows whose name is NOT in keepNames (prune removed defs). */
  pruneRepo(keepNames: string[]): void;
  close(): void;
};
```

- [ ] **Step 1: Write the failing tests** — cover CRUD, the atomic claim, and enabled-overlay survival:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobKind } from '../../src/queue/types.ts';
import { createTriggerStore } from '../../src/triggers/store.ts';
import { TriggerOrigin, TriggerOutcome, TriggerType } from '../../src/triggers/types.ts';

const cronInput = (name: string, next: number) => ({
  name, type: TriggerType.Cron, origin: TriggerOrigin.Console,
  target: { kind: JobKind.Chat, payload: { task: 'x' } },
  config: { schedule: '* * * * *' }, nextRunAt: next, enabled: true,
});

test('claimDueCron advances next_run_at in one transaction (no double-claim)', () => {
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
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
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
  const repo = { ...cronInput('nightly', 100), origin: TriggerOrigin.Repo };
  const created = store.upsertRepo(repo);
  store.update(created.id, { enabled: false }); // operator pauses it
  const again = store.upsertRepo({ ...repo, config: { schedule: '0 4 * * *' } });
  expect(again.id).toBe(created.id);         // same row
  expect(again.enabled).toBe(false);          // overlay survived
  expect((again.config as { schedule: string }).schedule).toBe('0 4 * * *'); // def updated
  store.close();
});

test('firings keyset list is newest-first and paginates', () => {
  const store = createTriggerStore({ path: mkdtempSync(join(tmpdir(), 'trg-')) });
  const t = store.create(cronInput('f', 100));
  for (let i = 1; i <= 3; i++) {
    store.recordFiring({ triggerId: t.id, firedAt: i, jobId: `j${i}`, runId: `r${i}`, outcome: TriggerOutcome.Fired });
  }
  const page = store.listFirings(t.id, { limit: 2 });
  expect(page.items.map((f) => f.firedAt)).toEqual([3, 2]);
  expect(page.total).toBe(3);
  expect(store.latestFiring(t.id)?.firedAt).toBe(3);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test -- -t "claimDueCron advances"` → FAIL.
- [ ] **Step 3: Write minimal implementation.** Open the DB exactly as `createJobStore` does (WAL, busy_timeout, foreign_keys), then `migrate(db, JOBS_DB_MIGRATIONS)`. Mirror `store.ts`'s `JobRowRaw`/`toJobRecord`/cursor helpers. The claim is the hard part — copy this body verbatim:

```ts
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
```

  Implement `upsertRepo` by `getByName(name, Repo)`: if found, `UPDATE` type/target/config/secret_ref/updated_at but **not** enabled/id/next_run_at; else `create({...input})`. `create` mints `id = trig-<base36 ms>-<base36 rand>` (mirror `newJobId`), serializes `target.payload`/`config` to JSON TEXT, writes `enabled` as `input.enabled === false ? 0 : 1`, stores `extra?.tokenHash` into `token_hash`. `recordFiring` mints `f-<...>` ids. `listFirings` uses the `(firedAt, id)` keyset descending (mirror `encodeJobCursor`/`decodeJobCursor` but on `fired_at`).
- [ ] **Step 4: Run tests to verify they pass** → PASS (all three).
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/store.ts tests/triggers/store.test.ts && bun run test -- -t "claimDueCron"`.

```bash
git add src/triggers/store.ts tests/triggers/store.test.ts
git commit -m "feat(triggers): trigger store with atomic claimDueCron + enabled overlay"
```

> **NOTE — delivery semantics: at-most-once per due time (not exactly-once).** The claim advances `next_run_at` and commits BEFORE `fire.ts` enqueues the job (the enqueue happens in a SEPARATE transaction, and — see Task 9's NOTE — even on a different DB connection). If the daemon crashes in the window between the claim-commit and the enqueue, that one due occurrence is silently dropped: the row's `next_run_at` has already moved forward, so no later tick re-claims it. This is the deliberate trade — the two-lock design (BEGIN IMMEDIATE claim + the daemon double-start pid guard) guarantees **we never DOUBLE-fire**, at the cost of possibly dropping one occurrence across a crash. A true exactly-once design (a two-phase claim: mark `claimed`, enqueue, then commit `fired`, with boot-time recovery of orphaned `claimed` rows) was considered and **rejected for this slice** — it adds a recovery state machine and a second write per fire for a failure window that only opens on a hard crash mid-fire; missing-a-tick on a crash is acceptable for scheduled agents, double-firing is not. Revisit if a stronger guarantee is ever required.

*Model: **Opus implementer + adversarial verify** (HARD §7.2). The reviewer specifically probes: (a) is the select+advance genuinely one `.immediate()` transaction (no read-then-write gap)? (b) does `upsertRepo` truly never clobber `enabled`? (c) is the keyset cursor stable under equal `fired_at`?*

