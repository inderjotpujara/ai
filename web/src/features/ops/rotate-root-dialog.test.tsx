import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RotateRootDialog } from './rotate-root-dialog.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RotateRootDialog', () => {
  it('keeps Rotate disabled until ROTATE is typed AND a secret is entered', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    render(<RotateRootDialog open onOpenChange={() => {}} />);
    const submit = screen.getByTestId('rotate-submit');
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('rotate-secret'), {
      target: { value: 'root-secret' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('rotate-confirm'), {
      target: { value: 'ROTATE' },
    });
    expect(submit).not.toBeDisabled();
    vi.unstubAllGlobals();
  });

  it('POSTs {rootSecret} and shows success once rotated', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ token: 'new-local' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<RotateRootDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('rotate-secret'), {
      target: { value: 'S' },
    });
    fireEvent.change(screen.getByTestId('rotate-confirm'), {
      target: { value: 'ROTATE' },
    });
    fireEvent.click(screen.getByTestId('rotate-submit'));

    await waitFor(() =>
      expect(
        screen.getByText(/rotated.*other devices signed out/i),
      ).toBeInTheDocument(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/security/rotate-root',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rootSecret: 'S' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('surfaces a wrong-secret error on 401 and changes nothing', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    render(<RotateRootDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('rotate-secret'), {
      target: { value: 'wrong' },
    });
    fireEvent.change(screen.getByTestId('rotate-confirm'), {
      target: { value: 'ROTATE' },
    });
    fireEvent.click(screen.getByTestId('rotate-submit'));

    await waitFor(() =>
      expect(screen.getByText(/wrong root secret/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/rotated.*other devices signed out/i),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
