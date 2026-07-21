import type { A2aAgentCard } from '@contracts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const DL_CLASS =
  'mt-2 grid grid-cols-[10rem_1fr] gap-x-2 gap-y-1 font-mono text-sm text-[var(--color-fg)]';

/** Live preview of the `AgentCard` the daemon advertises over A2A (Slice 31
 *  Incr 7, T25) — driven directly by `useA2aConfig().config.cardPreview`, so
 *  it reflects the CURRENTLY PERSISTED allowlist/enable state, not the
 *  `SkillAllowlistEditor`'s unsaved draft (the server derives the card from
 *  what is actually stored — this preview shows exactly that).
 *
 *  SECURITY: every field here (`name`, `url`, each skill's `name`/
 *  `description`) is operator- or peer-authored and renders via plain React
 *  interpolation ONLY — never `dangerouslySetInnerHTML` — so it is inert
 *  even if it contains HTML/script (`federation-tab.test.tsx`'s XSS test). */
export function CardPreview({ cardPreview }: { cardPreview: A2aAgentCard }) {
  return (
    <div data-testid="a2a-card-preview" className={CARD_CLASS}>
      <h2 className={CARD_TITLE_CLASS}>Agent card preview</h2>
      <dl className={DL_CLASS}>
        <dt className="text-[var(--color-muted)]">Name</dt>
        <dd data-testid="a2a-card-name">{cardPreview.name}</dd>
        <dt className="text-[var(--color-muted)]">URL</dt>
        <dd data-testid="a2a-card-url">{cardPreview.url}</dd>
        <dt className="text-[var(--color-muted)]">Streaming</dt>
        <dd data-testid="a2a-card-streaming">
          {cardPreview.capabilities.streaming ? 'yes' : 'no'}
        </dd>
        <dt className="text-[var(--color-muted)]">Push notifications</dt>
        <dd data-testid="a2a-card-push">
          {cardPreview.capabilities.pushNotifications ? 'yes' : 'no'}
        </dd>
      </dl>

      <h3 className={`${CARD_TITLE_CLASS} mt-3`}>Advertised skills</h3>
      {cardPreview.skills.length === 0 && (
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          No skills exposed.
        </p>
      )}
      {cardPreview.skills.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {cardPreview.skills.map((s) => (
            <li
              key={s.id}
              data-testid={`a2a-card-skill-${s.id}`}
              className="font-mono text-sm text-[var(--color-fg)]"
            >
              {/* SECURITY: plain interpolation only — see file-level note. */}
              <strong className="font-mono font-normal">{s.name}</strong> —{' '}
              {s.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
