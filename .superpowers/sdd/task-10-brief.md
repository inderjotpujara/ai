### Task 10: scheduler.ts — poll tick + Croner + misfire policy

**Files:**
- Create: `src/triggers/scheduler.ts`, `src/triggers/next-run.ts`
- Test: `tests/triggers/scheduler.test.ts`, `tests/triggers/next-run.test.ts`
- Dep: `bun add croner`

**Interfaces:**
- Consumes: `Cron` from `croner`; `TriggerStore`, `FireTrigger` (Task 9), `Trigger`, `CronConfig`, `TriggerType` from the triggers modules.
- Produces:
  - `src/triggers/next-run.ts`:
    - `validateCron(schedule: string, timezone?: string): boolean` — `try { new Cron(schedule, { timezone }); return true; } catch { return false; }`.
    - `computeNextRun(t: Trigger, after: number): number | null` — MUST NOT throw on a malformed pattern (an invalid repo/console cron must never crash the boot reconcile or a tick). Wrap the Croner call in try/catch and return `null` on any throw:

```ts
export function computeNextRun(t: Trigger, after: number): number | null {
  const cfg = t.config as CronConfig;
  try {
    return (
      new Cron(cfg.schedule, { timezone: cfg.timezone })
        .nextRun(new Date(after))
        ?.getTime() ?? null
    );
  } catch {
    // Malformed cron (bad pattern / bad timezone): return null rather than
    // throw. A null result parks the row (claimDueCron nulls next_run_at;
    // reconcile disables the trigger) — the daemon never crashes on a bad def.
    return null;
  }
}
```
  - `src/triggers/scheduler.ts`: `createScheduler(deps: { triggerStore: TriggerStore; fire: FireTrigger; pollMs: number; now?: () => number; setInterval?: typeof setInterval; clearInterval?: typeof clearInterval }): { start(): void; stop(): void; tick(now?: number): void; reconcile(now?: number): void }`.

- [ ] **Step 1: Write the failing tests** (fake clock — inject `now` + a manual `tick`, never real timers):

```ts
// tick fires a due cron at most once, then advances next_run_at to the future.
test('tick fires a due cron at-most-once per due time', () => { /* claimDueCron via computeNextRun; assert fire called once */ });
// misfire fire-once-on-boot: a past next_run_at + catchUp!==false → one catch-up on the first tick.
test('reconcile leaves a missed catchUp trigger due for exactly one boot fire', () => { /* ... */ });
// catchUp:false → reconcile skips the missed occurrence (advances to future, no fire on first tick).
test('reconcile with catchUp:false skips the missed fire', () => { /* ... */ });
// DST/next-time correctness via Croner.
test('computeNextRun respects an IANA timezone', () => {
  const t = { config: { schedule: '0 3 * * *', timezone: 'America/New_York' } } as any;
  expect(typeof computeNextRun(t, Date.parse('2026-03-08T00:00:00Z'))).toBe('number');
});
// I1: a malformed cron pattern returns null instead of throwing.
test('computeNextRun returns null for an unparseable cron (never throws)', () => {
  const t = { config: { schedule: 'not a cron' } } as any;
  expect(computeNextRun(t, Date.now())).toBeNull();
});
// I1: daemon-boot reconcile survives a bad repo cron — it disables the row, no throw.
test('reconcile disables (never throws on) a trigger whose cron is unparseable', () => {
  // store with one enabled cron trigger, config.schedule = 'not a cron', nextRunAt null.
  // scheduler.reconcile() must NOT throw; afterwards the row is enabled === false.
});
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.
- [ ] **Step 3: Write minimal implementation.**
  - `next-run.ts` as specified.
  - `scheduler.ts`:
    - `tick(now = deps.now())`: `const due = triggerStore.claimDueCron(now, (t) => computeNextRun(t, now)); for (const t of due) void deps.fire(t, { reason: 'cron' });` (fire is async; fire-and-forget, errors are handled inside fire).
    - `reconcile(now = deps.now())`: for every cron trigger (`triggerStore.list().filter(type===Cron)`), first compute `const next = computeNextRun(t, now)`. **If `next == null` (unparseable pattern), disable the row (`update(id, { enabled: false })`) and continue — a bad def never throws out of reconcile and never loops a tick (I1).** Otherwise: if `nextRunAt == null` → `update(id, { nextRunAt: next })`. Else if `nextRunAt < now` (missed while down): if `(config as CronConfig).catchUp === false` → advance without firing (`update(id, { nextRunAt: next })`); else LEAVE it (the first `tick` claims it, fires once, then advances — exactly one catch-up). Document this reasoning inline.
    - `start()`: `reconcile()` then `this._interval = (deps.setInterval ?? setInterval)(() => tick(), pollMs)`. `stop()`: `(deps.clearInterval ?? clearInterval)(this._interval)`.
- [ ] **Step 4: Run tests to verify they pass** → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/triggers/scheduler.ts src/triggers/next-run.ts tests/triggers/scheduler.test.ts tests/triggers/next-run.test.ts`.

```bash
git add src/triggers/scheduler.ts src/triggers/next-run.ts tests/triggers/scheduler.test.ts tests/triggers/next-run.test.ts package.json bun.lock
git commit -m "feat(triggers): poll-tick scheduler + Croner next-run + fire-once misfire"
```

*Model: **Opus implementer + adversarial verify** (HARD §7.2). Reviewer probes the misfire matrix: new trigger, past-due+catchUp, past-due+catchUp:false, future — exactly ONE catch-up fire on boot in each (not one per missed interval); and that `start()` calls `reconcile()` BEFORE the first tick.*

