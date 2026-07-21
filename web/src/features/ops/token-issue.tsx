import type { IssuedTokenWire } from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';

type Props = {
  tokens: IssuedTokenWire[];
  issueToken: (label: string) => Promise<{ id: string; token: string }>;
  revokeToken: (id: string) => Promise<void>;
};

/** Issue/revoke A2A Bearer tokens for the expose surface (Slice 31 Incr 7,
 *  T25). A freshly issued token's raw secret is shown EXACTLY ONCE — the
 *  `PairDeviceDialog`/`TriggerCreateDialog` webhook precedent:
 *  `useA2aConfig().issueToken` returns `{id, token}` from
 *  `POST /api/a2a/token` and never stores the raw value itself;
 *  `GET /api/a2a/config` only ever re-lists token METADATA
 *  (`IssuedTokenWire: {id, label, createdAt}`). This component's own
 *  `issued` state is the ONLY place the raw secret lives client-side, and it
 *  resets whenever the component unmounts (e.g. switching Ops tabs away and
 *  back) — after that, the secret is unrecoverable, matching
 *  `federation-tab.test.tsx`'s "shown once" test.
 *
 *  SECURITY: `t.label` is operator-authored and renders via plain React
 *  interpolation ONLY — never `dangerouslySetInnerHTML` (the
 *  `devices-tab.tsx` `d.label` precedent). */
export function TokenIssue({ tokens, issueToken, revokeToken }: Props) {
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<
    { id: string; token: string } | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleIssue() {
    if (!label.trim() || issuing) return;
    setIssuing(true);
    setError(undefined);
    try {
      const res = await issueToken(label.trim());
      setIssued(res);
      setLabel('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'issue failed');
    } finally {
      setIssuing(false);
    }
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value);
  }

  return (
    <div data-testid="a2a-token-issue" className={CARD_CLASS}>
      <h2 className={CARD_TITLE_CLASS}>A2A tokens</h2>

      <div className="mt-2 flex gap-2">
        <input
          data-testid="a2a-token-label"
          className={`${INPUT_CLASS} flex-1`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. peer-agent"
        />
        <Button
          data-testid="a2a-token-issue-submit"
          variant="accent"
          disabled={issuing || !label.trim()}
          onClick={() => void handleIssue()}
        >
          {issuing ? 'Issuing…' : 'Issue'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
          {error}
        </p>
      )}

      {issued && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm font-semibold text-[var(--color-accent)]">
            This token is shown once — copy it now. It will not be shown again.
          </p>
          <div className="flex gap-2">
            <input
              data-testid="a2a-token-secret"
              readOnly
              className={`${INPUT_CLASS} flex-1`}
              value={issued.token}
            />
            <Button onClick={() => copy(issued.token)}>Copy</Button>
          </div>
        </div>
      )}

      <h3 className={`${CARD_TITLE_CLASS} mt-3`}>Issued tokens</h3>
      {tokens.length === 0 && (
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          No tokens issued.
        </p>
      )}
      {tokens.length > 0 && (
        <ul className="mt-1 flex flex-col gap-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              data-testid={`a2a-token-row-${t.id}`}
              className="flex items-center justify-between gap-2 font-mono text-sm text-[var(--color-fg)]"
            >
              <span>
                {/* SECURITY: plain interpolation only — see file-level note. */}
                <strong className="font-mono font-normal">{t.label}</strong> ·
                created {new Date(t.createdAt).toLocaleString()}
              </span>
              <Button
                data-testid={`a2a-token-revoke-${t.id}`}
                onClick={() => void revokeToken(t.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
