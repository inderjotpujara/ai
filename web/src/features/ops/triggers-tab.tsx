import { JobKindWire } from '@contracts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';

/** The trigger types the Slice-25 backend will support, each firing a job of
 *  a given `JobKindWire` — named here so the intended shape is legible even
 *  before any trigger exists. Static only: no rows are ever populated from
 *  this list, it just labels the column-header concept below. */
const TRIGGER_KINDS: { type: string; targetKind: JobKindWire }[] = [
  { type: 'Cron', targetKind: JobKindWire.Workflow },
  { type: 'Webhook', targetKind: JobKindWire.Crew },
  { type: 'Event', targetKind: JobKindWire.Chat },
];

/** Triggers tab (Slice 25b Incr 8, D3): a STATIC, read-only preview of the
 *  intended trigger information architecture — deliberately not wired to any
 *  backend, because the trigger engine itself is Slice 25. Renders a
 *  column-header row (Type · Target job kind · Schedule) so the shape of the
 *  future trigger list is reviewable now, plus an empty-state card with the
 *  "arrives in Slice 25" copy. No `apiFetch`, no state, no effects. */
export function TriggersTab() {
  return (
    <section data-testid="ops-triggers" className="flex flex-col gap-4">
      <div className={CARD_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>Trigger list (preview)</h2>
        <table className="mt-2 w-full font-mono text-sm text-[var(--color-fg)]">
          <thead>
            <tr className="text-left text-[var(--color-muted)]">
              <th className="px-3 py-1.5">Type</th>
              <th className="px-3 py-1.5">Target job kind</th>
              <th className="px-3 py-1.5">Schedule</th>
            </tr>
          </thead>
          <tbody>
            {TRIGGER_KINDS.map((t) => (
              <tr key={t.type} className="text-[var(--color-muted)]">
                <td className="px-3 py-1.5">{t.type}</td>
                <td className="px-3 py-1.5">{t.targetKind}</td>
                <td className="px-3 py-1.5">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={CARD_CLASS}>
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">
          Triggers arrive in Slice 25.
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          This screen previews the intended trigger list — cron, webhook, and
          event triggers that fire a target job kind — but isn't wired to a
          backend yet. The trigger engine itself lands in Slice 25.
        </p>
      </div>
    </section>
  );
}
