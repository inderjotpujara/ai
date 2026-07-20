import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function triggerFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'trg-1',
    name: 'nightly-build',
    type: 'cron',
    enabled: true,
    target: { kind: 'workflow', payload: {} },
    config: { schedule: '0 2 * * *' },
    origin: 'console',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function firingFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'f-1',
    triggerId: 'trg-1',
    firedAt: 1700000000000,
    jobId: 'job-9',
    runId: 'run-9',
    outcome: 'fired',
    ...overrides,
  };
}

function stubFetch(
  handlers: Partial<{
    firings: (url: string) => Response | Promise<Response>;
    patch: () => Response | Promise<Response>;
    fire: () => Response | Promise<Response>;
  }> = {},
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/firings')) {
      return handlers.firings
        ? handlers.firings(url)
        : jsonResponse({ items: [firingFixture()], total: 1 });
    }
    if (method === 'PATCH') {
      return handlers.patch
        ? handlers.patch()
        : jsonResponse(triggerFixture({ enabled: false }));
    }
    if (url.endsWith('/fire') && method === 'POST') {
      return handlers.fire
        ? handlers.fire()
        : jsonResponse({ jobId: 'job-9', runId: 'run-9' }, 202);
    }
    if (method === 'DELETE') {
      return jsonResponse({ deleted: true });
    }
    return jsonResponse({ items: [triggerFixture()] });
  };
}

describe('TriggerFiringsDrawer', () => {
  it('opens the drawer on a trigger row click', async () => {
    vi.stubGlobal('fetch', vi.fn(stubFetch()));
    renderAt('/ops?tab=triggers');

    fireEvent.click(await screen.findByTestId('ops-trigger-row-trg-1'));

    const drawer = await screen.findByTestId('ops-trigger-firings-drawer');
    expect(within(drawer).getByText(/nightly-build/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('drawer lists firings with a working /runs/:id deep-link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        stubFetch({
          firings: () =>
            jsonResponse({
              items: [
                firingFixture({
                  id: 'f-1',
                  outcome: 'fired',
                  jobId: 'job-9',
                  runId: 'run-9',
                }),
                firingFixture({
                  id: 'f-2',
                  outcome: 'skipped-overlap',
                  jobId: undefined,
                  runId: undefined,
                }),
              ],
              total: 2,
            }),
        }),
      ),
    );
    renderAt('/ops?tab=triggers');

    fireEvent.click(await screen.findByTestId('ops-trigger-row-trg-1'));
    const drawer = await screen.findByTestId('ops-trigger-firings-drawer');

    await waitFor(() =>
      expect(within(drawer).getByTestId('ops-firing-f-1')).toBeInTheDocument(),
    );
    const row1 = within(drawer).getByTestId('ops-firing-f-1');
    expect(within(row1).getByText('fired')).toBeInTheDocument();
    expect(within(row1).getByRole('link', { name: /run-9/ })).toHaveAttribute(
      'href',
      '/runs/run-9',
    );

    const row2 = within(drawer).getByTestId('ops-firing-f-2');
    expect(within(row2).getByText('skipped-overlap')).toBeInTheDocument();
    expect(within(row2).queryByRole('link')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('keyset page-through (goNext/goFirst) pages the firings list', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        stubFetch({
          firings: (url) => {
            urls.push(url);
            if (url.includes('cursor=')) {
              return jsonResponse({
                items: [firingFixture({ id: 'f-2' })],
                total: 2,
              });
            }
            return jsonResponse({
              items: [firingFixture({ id: 'f-1' })],
              nextCursor: 'cur-1',
              total: 2,
            });
          },
        }),
      ),
    );
    renderAt('/ops?tab=triggers');

    fireEvent.click(await screen.findByTestId('ops-trigger-row-trg-1'));
    const drawer = await screen.findByTestId('ops-trigger-firings-drawer');
    await waitFor(() =>
      expect(within(drawer).getByTestId('ops-firing-f-1')).toBeInTheDocument(),
    );

    fireEvent.click(within(drawer).getByTestId('ops-firings-next'));
    await waitFor(() =>
      expect(within(drawer).getByTestId('ops-firing-f-2')).toBeInTheDocument(),
    );
    expect(urls.at(-1)).toContain('cursor=cur-1');

    fireEvent.click(within(drawer).getByTestId('ops-firings-first'));
    await waitFor(() =>
      expect(within(drawer).getByTestId('ops-firing-f-1')).toBeInTheDocument(),
    );

    vi.unstubAllGlobals();
  });

  it('toggle calls setEnabled; fire calls fire then shows the drawer', async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    let enabled = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        requests.push({
          method,
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes('/firings')) {
          return jsonResponse({ items: [firingFixture()], total: 1 });
        }
        if (method === 'PATCH') {
          enabled = false;
          return jsonResponse(triggerFixture({ enabled }));
        }
        if (url.endsWith('/fire') && method === 'POST') {
          return jsonResponse({ jobId: 'job-9', runId: 'run-9' }, 202);
        }
        return jsonResponse({ items: [triggerFixture({ enabled })] });
      }),
    );
    renderAt('/ops?tab=triggers');

    await screen.findByTestId('ops-trigger-row-trg-1');
    fireEvent.click(screen.getByTestId('ops-trigger-toggle-trg-1'));
    await waitFor(() =>
      expect(requests.some((r) => r.method === 'PATCH')).toBe(true),
    );
    const patchReq = requests.find((r) => r.method === 'PATCH');
    expect(patchReq?.body).toEqual({ enabled: false });
    // Toggling is an action button — it must NOT also open the drawer.
    expect(
      screen.queryByTestId('ops-trigger-firings-drawer'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ops-trigger-fire-trg-1'));
    await waitFor(() =>
      expect(
        requests.some((r) => r.method === 'POST' && r.url.endsWith('/fire')),
      ).toBe(true),
    );
    // Fire opens the drawer to show the new firing.
    expect(
      await screen.findByTestId('ops-trigger-firings-drawer'),
    ).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('clicking an action button does not also open the drawer', async () => {
    vi.stubGlobal('fetch', vi.fn(stubFetch()));
    renderAt('/ops?tab=triggers');

    await screen.findByTestId('ops-trigger-row-trg-1');
    fireEvent.click(screen.getByTestId('ops-trigger-delete-trg-1'));

    expect(
      screen.queryByTestId('ops-trigger-firings-drawer'),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('closes the drawer', async () => {
    vi.stubGlobal('fetch', vi.fn(stubFetch()));
    renderAt('/ops?tab=triggers');

    fireEvent.click(await screen.findByTestId('ops-trigger-row-trg-1'));
    await screen.findByTestId('ops-trigger-firings-drawer');
    fireEvent.click(screen.getByTestId('ops-trigger-firings-drawer-close'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('ops-trigger-firings-drawer'),
      ).not.toBeInTheDocument(),
    );

    vi.unstubAllGlobals();
  });

  it('a malicious trigger name renders as inert text in the drawer header', async () => {
    const xssName = '<img src=x onerror="alert(1)">';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/firings')) {
          return jsonResponse({ items: [], total: 0 });
        }
        return jsonResponse({ items: [triggerFixture({ name: xssName })] });
      }),
    );
    renderAt('/ops?tab=triggers');

    fireEvent.click(await screen.findByTestId('ops-trigger-row-trg-1'));
    await screen.findByTestId('ops-trigger-firings-drawer');

    expect(screen.getByText(xssName)).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
