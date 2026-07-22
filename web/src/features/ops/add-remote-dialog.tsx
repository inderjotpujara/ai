import type {
  A2aRemoteAddRequest,
  A2aRemoteTestRequest,
  A2aRemoteTestResponse,
} from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';

const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';
const FIELD_CLASS = 'flex flex-col gap-1 text-sm text-[var(--color-fg)]';
const PREVIEW_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `useA2aRemotes().testRemote` — a dry-run discover/pin preview; the
   *  remote store is untouched regardless of outcome. */
  testRemote: (body: A2aRemoteTestRequest) => Promise<A2aRemoteTestResponse>;
  /** `useA2aRemotes().addRemote` — validates, discovers+pins, and persists
   *  server-side, and (per that hook) already `refresh()`es the shared
   *  remote list on success, so this dialog doesn't need its own refresh
   *  callback. */
  addRemote: (body: A2aRemoteAddRequest) => Promise<unknown>;
};

/**
 * "Add remote agent" dialog (Slice 31 Incr 7, T26) — the Consume-side
 * counterpart to `PairDeviceDialog`: paste a peer's `cardUrl` + Bearer
 * `token`, dry-run `testRemote` to discover+preview the card and the hash
 * that WOULD be pinned (nothing persisted by a test), then Confirm calls
 * `addRemote`.
 *
 * DRY-RUN-BEFORE-PERSIST is enforced at the UI layer, not just the server's
 * own "discover+pin before persisting" guarantee (`server/a2a/remotes.ts`):
 * Confirm stays disabled until a successful test has completed for the
 * EXACT `cardUrl` currently in the field (`testedCardUrl === cardUrl`) —
 * editing the URL after a test invalidates the stale preview and re-locks
 * Confirm until it is re-tested.
 *
 * SECURITY: `testResult.card.name`/`.url` are PEER-authored strings — same
 * untrusted-peer-card class `CardPreview` documents on the Expose side —
 * rendered via plain React interpolation ONLY, never
 * `dangerouslySetInnerHTML`, so they stay inert even if they contain
 * HTML/script.
 */
export function AddRemoteDialog({
  open,
  onOpenChange,
  testRemote,
  addRemote,
}: Props) {
  const [name, setName] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const [token, setToken] = useState('');
  // The delegation-target skill (Task 30-FIX). Chosen from the tested card's
  // advertised `skills[]`; auto-selected when the card advertises exactly one.
  const [skillId, setSkillId] = useState('');
  const [testResult, setTestResult] = useState<
    A2aRemoteTestResponse | undefined
  >(undefined);
  const [testedCardUrl, setTestedCardUrl] = useState<string | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setCardUrl('');
    setToken('');
    setSkillId('');
    setTestResult(undefined);
    setTestedCardUrl(undefined);
    setError(undefined);
    setTesting(false);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleTest() {
    if (!cardUrl.trim() || testing) return;
    setTesting(true);
    setError(undefined);
    try {
      const result = await testRemote({ cardUrl });
      setTestResult(result);
      setTestedCardUrl(cardUrl);
      // Auto-select ONLY when the card advertises exactly one skill — then the
      // choice is unambiguous. With >1 (or 0) skills, leave this '' so the
      // operator must choose explicitly and Confirm stays locked until they do
      // (fail-closed, mirroring the server/CLI `resolveSkillId`, which REFUSES
      // to guess among multiple skills — a >1-skill card must never silently
      // default to skills[0]).
      const skills = result.card.skills;
      setSkillId(skills.length === 1 ? (skills[0]?.id ?? '') : '');
    } catch (e) {
      setTestResult(undefined);
      setTestedCardUrl(undefined);
      setSkillId('');
      setError(e instanceof Error ? e.message : 'test failed');
    } finally {
      setTesting(false);
    }
  }

  const canConfirm =
    !!testResult &&
    testedCardUrl === cardUrl &&
    !!name.trim() &&
    !!token.trim() &&
    // A delegation-target skill MUST be chosen — a peer with no selectable skill
    // cannot be delegated to (§7.4: the peer would reject every call with -32004).
    !!skillId;

  async function handleConfirm() {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await addRemote({ name, cardUrl, token, skillId });
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'add failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Add remote agent"
    >
      <div className="flex flex-col gap-3">
        <label className={FIELD_CLASS} htmlFor="add-remote-name">
          Name
          <input
            id="add-remote-name"
            data-testid="add-remote-name"
            className={INPUT_CLASS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. research-box"
          />
        </label>

        <label className={FIELD_CLASS} htmlFor="add-remote-card-url">
          Card URL
          <input
            id="add-remote-card-url"
            data-testid="add-remote-card-url"
            className={INPUT_CLASS}
            value={cardUrl}
            onChange={(e) => {
              setCardUrl(e.target.value);
              // Editing the URL invalidates any prior test result — Confirm
              // must not use a preview (or its skill) that no longer matches
              // this URL.
              setTestResult(undefined);
              setTestedCardUrl(undefined);
              setSkillId('');
            }}
            placeholder="https://peer.example/.well-known/agent-card.json"
          />
        </label>

        <label className={FIELD_CLASS} htmlFor="add-remote-token">
          Token
          <input
            id="add-remote-token"
            data-testid="add-remote-token"
            type="password"
            className={INPUT_CLASS}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="peer's bearer token"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}

        <Button
          data-testid="add-remote-test"
          disabled={testing || !cardUrl.trim()}
          onClick={() => void handleTest()}
        >
          {testing ? 'Testing…' : 'Test'}
        </Button>

        {testResult && testedCardUrl === cardUrl && (
          <div data-testid="add-remote-preview" className={PREVIEW_CLASS}>
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Discovered card
            </h3>
            {/* SECURITY: plain interpolation only — see file-level note. */}
            <p className="mt-1 font-mono text-sm text-[var(--color-fg)]">
              <strong className="font-normal">{testResult.card.name}</strong>
              {' — '}
              {testResult.card.url}
            </p>
            <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">
              Pin: {testResult.pinnedCardHash}
            </p>

            {/* Delegation-target skill picker (Task 30-FIX). Populated from the
                card's advertised skills[]; a sole skill is pre-selected. A card
                that advertises none cannot be delegated to — Confirm stays
                locked. SECURITY: skill id/name are peer-authored — rendered via
                plain interpolation only, never dangerouslySetInnerHTML. */}
            {testResult.card.skills.length > 0 ? (
              <label
                className={`${FIELD_CLASS} mt-3`}
                htmlFor="add-remote-skill"
              >
                Delegate skill
                <select
                  id="add-remote-skill"
                  data-testid="add-remote-skill"
                  className={INPUT_CLASS}
                  value={skillId}
                  onChange={(e) => setSkillId(e.target.value)}
                >
                  {/* Placeholder for the fail-closed unselected state (a >1-skill
                      card is NOT auto-defaulted): forces a deliberate choice and
                      makes the empty `skillId` representable in the control. */}
                  <option value="" disabled>
                    Select a skill…
                  </option>
                  {testResult.card.skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name} ({skill.id})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-muted)]">
                This agent advertises no skills — it cannot be added as a
                delegation target.
              </p>
            )}
          </div>
        )}

        <Button
          data-testid="add-remote-confirm"
          variant="accent"
          disabled={!canConfirm || submitting}
          onClick={() => void handleConfirm()}
        >
          {submitting ? 'Adding…' : 'Confirm'}
        </Button>
      </div>
    </Dialog>
  );
}
