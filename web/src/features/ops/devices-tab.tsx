import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { useDaemonStatus } from './use-daemon-status.ts';
import { useDevices } from './use-devices.ts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const DL_CLASS =
  'mt-2 grid grid-cols-[10rem_1fr] gap-x-2 gap-y-1 font-mono text-sm text-[var(--color-fg)]';
const RECIPE_CLASS =
  'mt-1 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs text-[var(--color-fg)]';

const TAILSCALE_RECIPE = `# Serve the Ops console over your tailnet (HTTPS, no extra certs):
tailscale serve --bg 4130

# Then restrict the daemon to that tailnet hostname:
AGENT_WEB_BIND=127.0.0.1
AGENT_WEB_ALLOWED_HOSTS=<device>.<tailnet>.ts.net`;

const CLOUDFLARE_RECIPE = `# Expose the Ops console via a Cloudflare Tunnel:
cloudflared tunnel --url http://127.0.0.1:4130

# Then restrict the daemon to the tunnel hostname it gives you:
AGENT_WEB_BIND=127.0.0.1
AGENT_WEB_ALLOWED_HOSTS=<your-tunnel>.trycloudflare.com`;

/** Devices & Access tab (Slice 25b Incr 7, T37): (a) a bind-status card
 *  reading `useDaemonStatus().status?.bind` plus static Tailscale/Cloudflare
 *  copy-paste recipes (spec D4 — text only, no live remote-access wiring
 *  here), (b) the device-session list from `useDevices()` with a wired
 *  Revoke button per row, and (c) "Pair a device" / "Rotate root token"
 *  buttons that open LOCAL-STATE placeholders — the real
 *  `<PairDeviceDialog>` (T38) and rotate-confirm dialog (T39/T40) mount in
 *  their own later tasks.
 *
 *  SECURITY (mandatory, Fable T17 finding): `DeviceDTO.label` is stored
 *  unsanitized server-side by design. It is rendered below via plain React
 *  interpolation (`{d.label}`) ONLY — never `dangerouslySetInnerHTML` — so
 *  React's default text-node escaping neutralizes any HTML/script a label
 *  contains. See `devices-tab.test.tsx`'s XSS-escape test. */
export function DevicesTab() {
  const { status } = useDaemonStatus();
  const { devices, error, revoke } = useDevices();
  const [pairOpen, setPairOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  return (
    <section data-testid="ops-devices" className="flex flex-col gap-4">
      <RegionErrorBoundary region="Ops: Bind status">
        <div data-testid="ops-devices-bind" className={CARD_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>Bind status</h2>
          {!status && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Loading…</p>
          )}
          {status && (
            <dl className={DL_CLASS}>
              <dt className="text-[var(--color-muted)]">Bind</dt>
              <dd data-testid="ops-devices-bind-address">{status.bind.bind}</dd>
              <dt className="text-[var(--color-muted)]">Allowed hosts</dt>
              <dd data-testid="ops-devices-bind-hosts">
                {status.bind.allowedHosts.join(', ') || '—'}
              </dd>
              <dt className="text-[var(--color-muted)]">Port</dt>
              <dd data-testid="ops-devices-bind-port">{status.bind.port}</dd>
              <dt className="text-[var(--color-muted)]">Session TTL (ms)</dt>
              <dd data-testid="ops-devices-bind-ttl">
                {status.bind.sessionTtlMs}
              </dd>
            </dl>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div data-testid="ops-devices-recipe-tailscale">
              <h3 className={CARD_TITLE_CLASS}>Tailscale</h3>
              <pre className={RECIPE_CLASS}>{TAILSCALE_RECIPE}</pre>
            </div>
            <div data-testid="ops-devices-recipe-cloudflare">
              <h3 className={CARD_TITLE_CLASS}>Cloudflare Tunnel</h3>
              <pre className={RECIPE_CLASS}>{CLOUDFLARE_RECIPE}</pre>
            </div>
          </div>
        </div>
      </RegionErrorBoundary>

      <RegionErrorBoundary region="Ops: Device sessions">
        <div data-testid="ops-devices-sessions" className={CARD_CLASS}>
          <div className="flex items-center justify-between">
            <h2 className={CARD_TITLE_CLASS}>Device sessions</h2>
            <Button
              data-testid="ops-devices-pair-open"
              onClick={() => setPairOpen(true)}
            >
              Pair a device
            </Button>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
              <strong className="text-[var(--color-fg)]">Devices</strong> failed
              to load. {error}
            </p>
          )}
          {!error && devices && devices.length === 0 && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              No paired devices
            </p>
          )}
          {!error && devices && devices.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {devices.map((d) => (
                <li
                  key={d.deviceId}
                  data-testid={`ops-device-row-${d.deviceId}`}
                  className="flex items-center justify-between gap-2 font-mono text-sm text-[var(--color-fg)]"
                >
                  <span>
                    {/* SECURITY: `d.label` MUST stay plain interpolation, in
                     *  its own element with no other text — see the
                     *  file-level note above. Never dangerouslySetInnerHTML. */}
                    <strong className="font-mono font-normal">{d.label}</strong>{' '}
                    · {d.deviceId} · created{' '}
                    {new Date(d.createdAt).toLocaleString()} · expires{' '}
                    {new Date(d.exp).toLocaleString()}
                  </span>
                  <Button
                    data-testid={`ops-device-revoke-${d.deviceId}`}
                    onClick={() => void revoke(d.deviceId)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {pairOpen && (
            // The real QR/token pairing dialog mounts here — Task 38.
            <p
              data-testid="ops-devices-pair-placeholder"
              className="mt-2 text-sm text-[var(--color-muted)]"
            >
              Pair-device dialog — coming in Task 38.
            </p>
          )}
        </div>
      </RegionErrorBoundary>

      <RegionErrorBoundary region="Ops: Root token">
        <div data-testid="ops-devices-rotate" className={CARD_CLASS}>
          <div className="flex items-center justify-between">
            <h2 className={CARD_TITLE_CLASS}>Root token</h2>
            <Button
              data-testid="ops-devices-rotate-open"
              onClick={() => setRotateOpen(true)}
            >
              Rotate root token
            </Button>
          </div>
          {rotateOpen && (
            // The real rotate-confirm dialog mounts here — a later task.
            <p
              data-testid="ops-devices-rotate-placeholder"
              className="mt-2 text-sm text-[var(--color-muted)]"
            >
              Rotate-root-token confirm — coming in a later task.
            </p>
          )}
        </div>
      </RegionErrorBoundary>
    </section>
  );
}
