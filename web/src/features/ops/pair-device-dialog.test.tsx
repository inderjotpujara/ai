import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PairDeviceDialog } from './pair-device-dialog.tsx';

describe('PairDeviceDialog', () => {
  it('pairs and shows the token + QR exactly once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              deviceId: 'd-new',
              token: 'tok-123',
              pairingUrl: 'http://ts.example/#token=tok-123',
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    render(<PairDeviceDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('pair-label'), {
      target: { value: 'phone' },
    });
    fireEvent.click(screen.getByTestId('pair-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('pair-token')).toHaveValue('tok-123'),
    );
    // <img> data-URI, no network — self-contained QR of the pairingUrl.
    expect(screen.getByTestId('pair-qr')).toBeInTheDocument();
    expect(screen.getByTestId('pair-url')).toHaveValue(
      'http://ts.example/#token=tok-123',
    );
    // The "shown once" warning is present.
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('POSTs {label} to /api/devices', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            deviceId: 'd-new',
            token: 'tok-abc',
            pairingUrl: 'http://ts.example/#token=tok-abc',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<PairDeviceDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('pair-label'), {
      target: { value: 'laptop' },
    });
    fireEvent.click(screen.getByTestId('pair-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('pair-token')).toHaveValue('tok-abc'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/devices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ label: 'laptop' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('calls onPaired so the caller can refresh its device list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              deviceId: 'd-new',
              token: 'tok-xyz',
              pairingUrl: 'http://ts.example/#token=tok-xyz',
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const onPaired = vi.fn();
    render(
      <PairDeviceDialog open onOpenChange={() => {}} onPaired={onPaired} />,
    );
    fireEvent.change(screen.getByTestId('pair-label'), {
      target: { value: 'tablet' },
    });
    fireEvent.click(screen.getByTestId('pair-submit'));
    await waitFor(() => expect(onPaired).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it('clears the token from state when the dialog is closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              deviceId: 'd-new',
              token: 'tok-close',
              pairingUrl: 'http://ts.example/#token=tok-close',
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <PairDeviceDialog open onOpenChange={onOpenChange} />,
    );
    fireEvent.change(screen.getByTestId('pair-label'), {
      target: { value: 'phone' },
    });
    fireEvent.click(screen.getByTestId('pair-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('pair-token')).toHaveValue('tok-close'),
    );

    // Clicking "Done" closes the dialog through the component's own
    // handleOpenChange, which discards the pairing result from state.
    fireEvent.click(screen.getByTestId('pair-done'));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Reopening must not show stale state — the token was one-time-only.
    rerender(<PairDeviceDialog open onOpenChange={onOpenChange} />);
    expect(screen.queryByTestId('pair-token')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
