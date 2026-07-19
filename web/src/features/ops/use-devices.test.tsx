import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDevices } from './use-devices.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function DevicesProbe() {
  const { devices } = useDevices();
  return (
    <div data-testid="count">
      {devices ? String(devices.length) : 'loading'}
    </div>
  );
}

describe('useDevices', () => {
  it('fetches the device list on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [{ deviceId: 'd1', label: 'Pixel 9', createdAt: 1, exp: 2 }],
        }),
      ),
    );
    render(<DevicesProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });
});
