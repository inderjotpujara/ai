import type { TriggerDTO } from '@contracts';
import { TriggerOriginWire, TriggerTypeWire } from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { TriggerCreateDialog } from './trigger-create-dialog.tsx';
import { useTriggers } from './use-triggers.ts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';

function isRepoOrigin(trigger: TriggerDTO): boolean {
  return trigger.origin === TriggerOriginWire.Repo;
}

/** Cron's `config.schedule` is the only per-`type` config field worth
 *  surfacing as a "Schedule" column — `config` stays opaque JSON on the wire
 *  (its shape is validated per-`type` server-side, see `requests.ts`'s
 *  `CronConfigSchema`), so this narrows defensively rather than trusting the
 *  shape. Webhook/file/jobchain triggers have no single-string schedule. */
function scheduleLabel(trigger: TriggerDTO): string {
  if (trigger.type !== TriggerTypeWire.Cron) return '—';
  const config = trigger.config;
  if (config && typeof config === 'object' && 'schedule' in config) {
    const schedule = (config as { schedule?: unknown }).schedule;
    if (typeof schedule === 'string') return schedule;
  }
  return '—';
}

/** Triggers tab (Slice 25, Task 28): the LIVE trigger list, driven by
 *  `useTriggers` (Task 27) — replaces the Slice-25b static preview stub.
 *  Columns extend the stub's three (Type · Target job kind · Schedule) with
 *  Enabled and Last fired, mirroring `JobsTab`'s table idiom. The create
 *  dialog (Task 29) and firings drawer (Task 30) aren't wired yet — this
 *  task delivers the list plus the enable/disable toggle, manual-fire, and
 *  delete affordances (`useTriggers`'s existing mutations).
 *
 *  SECURITY (Fable T17 stored-XSS lesson, `devices-tab.tsx` precedent):
 *  `trigger.name` is user-authored and rendered via plain React
 *  interpolation (`{trigger.name}`) ONLY — never `dangerouslySetInnerHTML` —
 *  so React's default text-node escaping neutralizes any HTML it contains.
 *
 *  ORIGIN-CONDITIONAL AFFORDANCES (M6, mirrors the Task 23 backend rule): a
 *  repo-origin trigger's row renders ONLY the pause/resume toggle and the
 *  manual-fire button, plus a "repo-defined" badge — no delete/edit control,
 *  since the server 403s a repo delete anyway. Console-origin rows render
 *  the full set (toggle · fire · delete).
 *
 *  A "New trigger" button mounts `TriggerCreateDialog` (Task 29) — its
 *  `onCreated` is wired to THIS tab's own `refresh()` so a created trigger
 *  appears in the list without a page reload (the `PairDeviceDialog`/
 *  `onPaired` precedent, Slice 25b T38). */
export function TriggersTab() {
  const { triggers, error, refresh, setEnabled, fire, remove } = useTriggers();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section data-testid="ops-triggers" className="flex flex-col gap-4">
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between">
          <h2 className={CARD_TITLE_CLASS}>Triggers</h2>
          <Button
            data-testid="ops-triggers-create-open"
            onClick={() => setCreateOpen(true)}
          >
            New trigger
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
            <strong className="text-[var(--color-fg)]">Triggers</strong> failed
            to load. {error}
          </p>
        )}

        {!error && triggers === undefined && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">Loading…</p>
        )}

        {!error && triggers && triggers.length === 0 && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No triggers configured yet.
          </p>
        )}

        {!error && triggers && triggers.length > 0 && (
          <table
            data-testid="ops-triggers-table"
            className="mt-2 w-full font-mono text-sm text-[var(--color-fg)]"
          >
            <thead>
              <tr className="text-left text-[var(--color-muted)]">
                <th className="px-3 py-1.5">Name</th>
                <th className="px-3 py-1.5">Type</th>
                <th className="px-3 py-1.5">Target job kind</th>
                <th className="px-3 py-1.5">Schedule</th>
                <th className="px-3 py-1.5">Enabled</th>
                <th className="px-3 py-1.5">Last fired</th>
                <th className="px-3 py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((trigger) => {
                const repoOrigin = isRepoOrigin(trigger);
                return (
                  <tr
                    key={trigger.id}
                    data-testid={`ops-trigger-row-${trigger.id}`}
                    className="text-[var(--color-muted)]"
                  >
                    <td className="px-3 py-1.5 text-[var(--color-fg)]">
                      {/* SECURITY: plain interpolation only — see file-level note. */}
                      {trigger.name}
                      {repoOrigin && (
                        <span
                          data-testid={`ops-trigger-repo-badge-${trigger.id}`}
                          className="ml-2 rounded border border-[var(--color-border)] px-1 text-xs uppercase tracking-wide"
                        >
                          repo-defined
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{trigger.type}</td>
                    <td className="px-3 py-1.5">{trigger.target.kind}</td>
                    <td className="px-3 py-1.5">{scheduleLabel(trigger)}</td>
                    <td className="px-3 py-1.5">
                      {trigger.enabled ? 'Enabled' : 'Disabled'}
                    </td>
                    <td className="px-3 py-1.5">
                      {trigger.lastFiredAt
                        ? new Date(trigger.lastFiredAt).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Button
                          data-testid={`ops-trigger-toggle-${trigger.id}`}
                          onClick={() =>
                            void setEnabled(trigger.id, !trigger.enabled)
                          }
                        >
                          {trigger.enabled ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          data-testid={`ops-trigger-fire-${trigger.id}`}
                          onClick={() => void fire(trigger.id)}
                        >
                          Fire now
                        </Button>
                        {/* Origin-conditional (M6): only console-origin
                         *  triggers offer delete — a repo row's delete would
                         *  403 server-side, so the UI never offers it. */}
                        {!repoOrigin && (
                          <Button
                            data-testid={`ops-trigger-delete-${trigger.id}`}
                            onClick={() => void remove(trigger.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <TriggerCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={refresh}
        />
      </div>
    </section>
  );
}
