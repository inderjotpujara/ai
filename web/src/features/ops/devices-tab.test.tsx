import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

const oneDevice = {
  items: [{ deviceId: 'dev-1', label: 'phone', createdAt: 1, exp: 2 }],
};

function mockFetch(overrides?: { daemon?: unknown; devices?: unknown }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/daemon/status')) {
      return jsonResponse(overrides?.daemon ?? daemonStatus);
    }
    if (url.includes('/api/devices')) {
      return jsonResponse(overrides?.devices ?? oneDevice);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('DevicesTab', () => {
  it('renders bind status, a Tailscale recipe, and the device session list with Revoke', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops?tab=devices');

    expect(await screen.findByTestId('ops-devices')).toBeInTheDocument();

    // Bind status card: bind address + allowed host from status.bind.
    await waitFor(() =>
      expect(screen.getByTestId('ops-devices-bind-address')).toHaveTextContent(
        '127.0.0.1',
      ),
    );
    expect(screen.getByTestId('ops-devices-bind-hosts')).toHaveTextContent(
      'ts.example',
    );

    // Static Tailscale recipe card is present.
    expect(
      screen.getByTestId('ops-devices-recipe-tailscale'),
    ).toBeInTheDocument();

    // Device session row + its Revoke button.
    await waitFor(() =>
      expect(screen.getByTestId('ops-device-row-dev-1')).toBeInTheDocument(),
    );
    expect(screen.getByText('phone')).toBeInTheDocument();
    expect(screen.getByTestId('ops-device-revoke-dev-1')).toHaveTextContent(
      'Revoke',
    );

    vi.unstubAllGlobals();
  });

  it('renders a device label containing HTML as literal text, never as markup (Fable T17 security finding)', async () => {
    const xssLabel = '<img src=x onerror="alert(1)">';
    vi.stubGlobal(
      'fetch',
      mockFetch({
        devices: {
          items: [
            { deviceId: 'dev-xss', label: xssLabel, createdAt: 1, exp: 2 },
          ],
        },
      }),
    );
    renderAt('/ops?tab=devices');

    await waitFor(() =>
      expect(screen.getByTestId('ops-device-row-dev-xss')).toBeInTheDocument(),
    );

    // The label renders as literal text (React escapes it) — no <img> element
    // is created in the DOM, so there is no onerror handler to fire.
    expect(screen.getByText(xssLabel)).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
