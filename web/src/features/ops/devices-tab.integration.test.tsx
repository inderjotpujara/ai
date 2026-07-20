import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const daemonStatus = {
  running: true,
  pid: 7,
  startedAt: 1,
  uptimeMs: 1,
  bind: {
    bind: '127.0.0.1',
    allowedHosts: ['ts.example'],
    port: 4130,
    sessionTtlMs: 1,
  },
};

/** Full-flow integration test for the Devices & Access tab (Slice 25b Incr
 *  7, T40): a stateful `fetch` mock backs a real in-memory device list that
 *  `POST /devices` grows and `POST /devices/:id/revoke` shrinks, so pairing
 *  and revoking through the real `DevicesTab` + `PairDeviceDialog` wiring
 *  (not each component in isolation, as `pair-device-dialog.test.tsx` /
 *  `devices-tab.test.tsx` already cover) is exercised end-to-end. */
describe('DevicesTab integration', () => {
  it('pairing a device shows the token/QR once and adds a row; revoking removes the row', async () => {
    let devices = [{ deviceId: 'd1', label: 'phone', createdAt: 1, exp: 2 }];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';

        if (url.includes('/api/daemon/status')) {
          return jsonResponse(daemonStatus);
        }
        if (url.includes('/api/devices/d2/revoke') && method === 'POST') {
          devices = devices.filter((d) => d.deviceId !== 'd2');
          return jsonResponse({});
        }
        if (url.endsWith('/api/devices') && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { label: string };
          devices = [
            ...devices,
            { deviceId: 'd2', label: body.label, createdAt: 3, exp: 4 },
          ];
          return jsonResponse({
            deviceId: 'd2',
            token: 'tok-d2',
            pairingUrl: 'http://ts.example/#token=tok-d2',
          });
        }
        if (url.endsWith('/api/devices') && method === 'GET') {
          return jsonResponse({ items: devices });
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/ops?tab=devices');
    await screen.findByTestId('ops-devices');

    // Starting state: the one pre-existing device is listed.
    await waitFor(() =>
      expect(screen.getByTestId('ops-device-row-d1')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('ops-device-row-d2')).not.toBeInTheDocument();

    // Open the pair dialog and submit a label.
    fireEvent.click(screen.getByTestId('ops-devices-pair-open'));
    fireEvent.change(await screen.findByTestId('pair-label'), {
      target: { value: 'New Phone' },
    });
    fireEvent.click(screen.getByTestId('pair-submit'));

    // Token + QR are shown exactly once, and only once.
    await waitFor(() =>
      expect(screen.getByTestId('pair-token')).toHaveValue('tok-d2'),
    );
    expect(screen.getAllByTestId('pair-token')).toHaveLength(1);
    expect(screen.getByTestId('pair-qr')).toBeInTheDocument();

    // The new device row appears in the list (onPaired triggered a refresh).
    await waitFor(() =>
      expect(screen.getByTestId('ops-device-row-d2')).toBeInTheDocument(),
    );

    // Closing the dialog discards the one-time token from the DOM.
    fireEvent.click(screen.getByTestId('pair-done'));
    await waitFor(() =>
      expect(screen.queryByTestId('pair-token')).not.toBeInTheDocument(),
    );

    // Revoking the new device removes its row on the next list refresh, and
    // leaves the original device untouched.
    fireEvent.click(screen.getByTestId('ops-device-revoke-d2'));
    await waitFor(() =>
      expect(screen.queryByTestId('ops-device-row-d2')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('ops-device-row-d1')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
