import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

describe('TriggersTab', () => {
  it('renders live trigger rows from useTriggers (keeps data-testid ops-triggers)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [triggerFixture()] })),
    );
    renderAt('/ops?tab=triggers');

    expect(await screen.findByTestId('ops-triggers')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('ops-trigger-row-trg-1')).toBeInTheDocument(),
    );
    const row = within(screen.getByTestId('ops-trigger-row-trg-1'));
    expect(row.getByText('nightly-build')).toBeInTheDocument();
    expect(row.getByText('cron')).toBeInTheDocument();
    expect(row.getByText('workflow')).toBeInTheDocument();
    expect(row.getByText('0 2 * * *')).toBeInTheDocument();
    expect(row.getByText('Enabled')).toBeInTheDocument();
    expect(row.getByText('Never')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('shows a real empty-list state when there are no triggers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    renderAt('/ops?tab=triggers');

    expect(await screen.findByTestId('ops-triggers')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText('No triggers configured yet.'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText('Triggers arrive in Slice 25.'),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('a malicious trigger name renders as inert text (no dangerouslySetInnerHTML)', async () => {
    const xssName = '<img src=x onerror="alert(1)">';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ items: [triggerFixture({ name: xssName })] }),
      ),
    );
    renderAt('/ops?tab=triggers');

    await waitFor(() =>
      expect(screen.getByTestId('ops-trigger-row-trg-1')).toBeInTheDocument(),
    );

    // The name renders as literal text (React escapes it) — no <img> element
    // is created in the DOM, so there is no onerror handler to fire.
    expect(screen.getByText(xssName)).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('a repo-origin row renders no delete/edit affordance (pause/resume only)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            triggerFixture({ id: 'trg-repo', origin: 'repo' }),
            triggerFixture({ id: 'trg-console', origin: 'console' }),
          ],
        }),
      ),
    );
    renderAt('/ops?tab=triggers');

    await waitFor(() =>
      expect(
        screen.getByTestId('ops-trigger-row-trg-repo'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('ops-trigger-row-trg-console'),
    ).toBeInTheDocument();

    // Toggle (pause/resume) present on both origins.
    expect(
      screen.getByTestId('ops-trigger-toggle-trg-repo'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('ops-trigger-toggle-trg-console'),
    ).toBeInTheDocument();

    // Fire present on both origins.
    expect(screen.getByTestId('ops-trigger-fire-trg-repo')).toBeInTheDocument();
    expect(
      screen.getByTestId('ops-trigger-fire-trg-console'),
    ).toBeInTheDocument();

    // Delete only on the console-origin row — never on the repo row.
    expect(
      screen.getByTestId('ops-trigger-delete-trg-console'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-trigger-delete-trg-repo'),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
