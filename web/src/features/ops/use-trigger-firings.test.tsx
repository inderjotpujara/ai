import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTriggerFirings } from './use-trigger-firings.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function firingFixture(id: string) {
  return { id, triggerId: 'trg-1', firedAt: 1, outcome: 'fired' };
}

describe('useTriggerFirings', () => {
  it('fetches the first page for the given trigger id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/triggers/trg-1/firings');
        return jsonResponse({ items: [firingFixture('f-1')], total: 1 });
      }),
    );

    function Probe() {
      const { page } = useTriggerFirings('trg-1');
      return (
        <div data-testid="count">
          {page ? String(page.items.length) : 'loading'}
        </div>
      );
    }
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });

  it('goNext pages through with the returned cursor', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('cursor=')) {
          return jsonResponse({ items: [firingFixture('f-2')], total: 2 });
        }
        return jsonResponse({
          items: [firingFixture('f-1')],
          nextCursor: 'cur-1',
          total: 2,
        });
      }),
    );

    let hook: ReturnType<typeof useTriggerFirings> | undefined;
    function Probe() {
      hook = useTriggerFirings('trg-1');
      return (
        <div data-testid="count">
          {hook.page ? hook.page.items[0]?.id : 'loading'}
        </div>
      );
    }
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('f-1'),
    );

    hook?.goNext();
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('f-2'),
    );
    expect(urls.at(-1)).toContain('cursor=cur-1');

    hook?.goFirst();
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('f-1'),
    );

    vi.unstubAllGlobals();
  });

  it('surfaces a fetch failure as `error`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    function Probe() {
      const { page, error } = useTriggerFirings('trg-1');
      return (
        <div data-testid="count">
          {error ? `error:${error}` : page ? 'loaded' : 'loading'}
        </div>
      );
    }
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('error:'),
    );
    vi.unstubAllGlobals();
  });
});
