import { CardPreview } from './card-preview.tsx';
import { SkillAllowlistEditor } from './skill-allowlist-editor.tsx';
import { TokenIssue } from './token-issue.tsx';
import { useA2aConfig } from './use-a2a-config.ts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const SECTION_TITLE_CLASS = 'font-mono text-sm text-[var(--color-fg)]';

/** Federation tab (Slice 31 Incr 7): the A2A interop console — Expose (this
 *  task, T25) + Consume (T26, placeholder below). Expose is one
 *  `useA2aConfig()` instance driving three panels: the allowlist editor
 *  (`skill-allowlist-editor.tsx`, T25), a live card preview
 *  (`card-preview.tsx`), and token issue/revoke (`token-issue.tsx`) — a
 *  skill save / token issue / revoke each `refresh()`es the shared config,
 *  so every panel re-renders from the same source of truth (the
 *  `DevicesTab`/`useDevices` precedent).
 *
 *  SECURITY: none of this component's own JSX touches operator/peer
 *  strings directly — those all render inside the three child components,
 *  each documenting its own plain-interpolation-only contract. */
export function FederationTab() {
  const { config, error, putSkills, issueToken, revokeToken } = useA2aConfig();

  return (
    <section data-testid="ops-federation" className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE_CLASS}>Expose</h2>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-muted)]">
          <strong className="text-[var(--color-fg)]">Federation config</strong>{' '}
          failed to load. {error}
        </p>
      )}

      {!error && !config && (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      )}

      {!error && config && (
        <>
          <SkillAllowlistEditor skills={config.skills} onSave={putSkills} />
          <CardPreview cardPreview={config.cardPreview} />
          <TokenIssue
            tokens={config.tokens}
            issueToken={issueToken}
            revokeToken={revokeToken}
          />
        </>
      )}

      <h2 className={SECTION_TITLE_CLASS}>Consume</h2>
      <div
        data-testid="ops-federation-consume-placeholder"
        className={CARD_CLASS}
      >
        <h3 className={CARD_TITLE_CLASS}>Remote peers</h3>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Remote-peer discovery, pinning, and delegation land in Task 26.
        </p>
      </div>
    </section>
  );
}
