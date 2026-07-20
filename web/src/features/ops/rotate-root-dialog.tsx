import { useState } from 'react';
import { ApiError } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';
import { useDevices } from './use-devices.ts';

const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';
const FIELD_CLASS = 'flex flex-col gap-1 text-sm text-[var(--color-fg)]';

const CONFIRM_WORD = 'ROTATE';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Break-glass "Rotate root token" dialog (Slice 25b Incr 7, T39). Rotating
 *  the root secret invalidates EVERY paired device session, so this is
 *  gated behind a strong confirm: the operator must both type the literal
 *  word `ROTATE` and supply the current root secret before the Rotate
 *  button enables. `useDevices().rotate` performs the POST, adopts the
 *  re-minted `'local'` token into `localStorage` so THIS tab keeps working
 *  (see `use-devices.ts`), and bumps its own refresh tick so the device
 *  list (now empty — rotate clears the registry) reloads. A wrong-secret
 *  401 surfaces an error and leaves everything else untouched. */
export function RotateRootDialog({ open, onOpenChange }: Props) {
  const { rotate } = useDevices();
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  function reset() {
    setSecret('');
    setConfirm('');
    setSubmitting(false);
    setError(undefined);
    setDone(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit() {
    if (confirm !== CONFIRM_WORD || !secret || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await rotate(secret);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('wrong root secret');
      } else {
        setError(e instanceof Error ? e.message : 'rotate failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Rotate root token"
    >
      {!done && (
        <div className="flex flex-col gap-3">
          <p
            role="alert"
            className="text-sm font-semibold text-[var(--color-accent)]"
          >
            This logs out EVERY other device and cannot be undone.
          </p>

          <label className={FIELD_CLASS} htmlFor="rotate-secret">
            Root secret
            <input
              id="rotate-secret"
              data-testid="rotate-secret"
              type="password"
              className={INPUT_CLASS}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>

          <label className={FIELD_CLASS} htmlFor="rotate-confirm">
            Type {CONFIRM_WORD} to confirm
            <input
              id="rotate-confirm"
              data-testid="rotate-confirm"
              className={INPUT_CLASS}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-muted)]">
              {error}
            </p>
          )}

          <Button
            data-testid="rotate-submit"
            variant="accent"
            disabled={confirm !== CONFIRM_WORD || !secret || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Rotating…' : 'Rotate'}
          </Button>
        </div>
      )}

      {done && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-fg)]">
            Rotated — other devices signed out.
          </p>
          <Button
            data-testid="rotate-done"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}
