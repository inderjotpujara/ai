import type { DevicePairResponse } from '@contracts';
import { DevicePairResponseSchema } from '@contracts';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';

const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';
const FIELD_CLASS = 'flex flex-col gap-1 text-sm text-[var(--color-fg)]';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the caller (DevicesTab, holding its own `useDevices()`) refresh
   *  its device-session list after a successful pair. `useDevices().pair`
   *  already bumps its own refresh tick, so passing that hook's `pair`
   *  isn't required here — this dialog performs the POST itself so it
   *  stays mountable standalone (see the component test). */
  onPaired?: () => void;
};

/** "Pair a device" dialog (Slice 25b Incr 7, T38). POSTs `{label}` to
 *  `/api/devices`; the response `{deviceId, token, pairingUrl}` is shown
 *  EXACTLY ONCE — the server never re-lists the token or pairingUrl, so
 *  once this dialog is closed they are gone from the client too (`result`
 *  resets to `undefined`). The pairingUrl is also rendered as a QR code via
 *  the bundled `qrcode` package (`QRCode.toDataURL`), producing a
 *  `data:image/png;base64,...` string entirely client-side — no CDN, no
 *  network fetch, satisfying the CSP no-external-image constraint. */
export function PairDeviceDialog({ open, onOpenChange, onPaired }: Props) {
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<DevicePairResponse | undefined>(
    undefined,
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!result) {
      setQrDataUrl(undefined);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(result.pairingUrl)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        // QR generation is a nice-to-have on top of the copyable pairingUrl
        // field below — a failure here shouldn't block pairing.
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  function reset() {
    setLabel('');
    setResult(undefined);
    setError(undefined);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit() {
    if (!label.trim() || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await apiFetch('/devices', {
        method: 'POST',
        body: { label },
        schema: DevicePairResponseSchema,
      });
      setResult(res);
      onPaired?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'pairing failed');
    } finally {
      setSubmitting(false);
    }
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} title="Pair a device">
      {!result && (
        <div className="flex flex-col gap-3">
          <label className={FIELD_CLASS} htmlFor="pair-label">
            Label
            <input
              id="pair-label"
              data-testid="pair-label"
              className={INPUT_CLASS}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My iPhone"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-muted)]">
              Pairing failed. {error}
            </p>
          )}
          <Button
            data-testid="pair-submit"
            variant="accent"
            disabled={submitting || !label.trim()}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Pairing…' : 'Pair'}
          </Button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-[var(--color-accent)]">
            This token is shown once — copy it now. It will not be shown again.
          </p>

          <label className={FIELD_CLASS} htmlFor="pair-url">
            Pairing URL
            <div className="flex gap-2">
              <input
                id="pair-url"
                data-testid="pair-url"
                readOnly
                className={`${INPUT_CLASS} flex-1`}
                value={result.pairingUrl}
              />
              <Button onClick={() => copy(result.pairingUrl)}>Copy</Button>
            </div>
          </label>

          <label className={FIELD_CLASS} htmlFor="pair-token">
            Token
            <div className="flex gap-2">
              <input
                id="pair-token"
                data-testid="pair-token"
                readOnly
                className={`${INPUT_CLASS} flex-1`}
                value={result.token}
              />
              <Button onClick={() => copy(result.token)}>Copy</Button>
            </div>
          </label>

          <img
            data-testid="pair-qr"
            src={qrDataUrl}
            alt="QR code for the pairing URL"
            className="h-40 w-40 self-center bg-white p-2"
          />

          <Button
            data-testid="pair-done"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}
