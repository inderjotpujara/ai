import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../app/router.tsx';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { renderAt } from '../../test/render.tsx';

/** Builds its own router (rather than the shared `renderAt`) so tests can
 *  read `router.state.location.search` directly — same pattern as
 *  `run-detail.test.tsx`'s cross-navigation checks — to prove clicking/
 *  keying a tab really updates the `?tab=` search param, not just the
 *  rendered DOM. */
function renderOpsRouter() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/ops'] }),
  });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

describe('OpsArea', () => {
  it('renders the Ops shell with five tabs, defaulting to Overview', async () => {
    renderAt('/ops');
    expect(await screen.findByTestId('area-ops')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Triggers' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Devices & Access' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Federation' })).toBeInTheDocument();
  });

  it('deep-links to a tab via ?tab=', async () => {
    renderAt('/ops?tab=jobs');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-jobs')).toBeInTheDocument();
  });

  it('click-switches across all five tabs, updating aria-selected + the ?tab= search param each time', async () => {
    const router = renderOpsRouter();
    await screen.findByTestId('area-ops');
    expect(router.state.location.search).toEqual({ tab: 'overview' });

    fireEvent.click(screen.getByTestId('ops-tab-jobs'));
    await waitFor(() =>
      expect(screen.getByTestId('ops-tab-jobs')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-jobs')).toBeInTheDocument();
    expect(screen.queryByTestId('ops-panel-overview')).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'jobs' });

    fireEvent.click(screen.getByTestId('ops-tab-triggers'));
    await waitFor(() =>
      expect(screen.getByTestId('ops-tab-triggers')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-triggers')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'triggers' });

    fireEvent.click(screen.getByTestId('ops-tab-devices'));
    await waitFor(() =>
      expect(screen.getByTestId('ops-tab-devices')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-devices')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'devices' });

    fireEvent.click(screen.getByTestId('ops-tab-federation'));
    await waitFor(() =>
      expect(screen.getByTestId('ops-tab-federation')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-federation')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'federation' });

    fireEvent.click(screen.getByTestId('ops-tab-overview'));
    await waitFor(() =>
      expect(screen.getByTestId('ops-tab-overview')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByTestId('ops-panel-overview')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ tab: 'overview' });
  });

  it('moves focus with ArrowRight/ArrowLeft (roving tabindex), wrapping at both ends', async () => {
    renderAt('/ops');
    const overview = await screen.findByTestId('ops-tab-overview');
    const jobs = screen.getByTestId('ops-tab-jobs');
    const triggers = screen.getByTestId('ops-tab-triggers');
    const devices = screen.getByTestId('ops-tab-devices');
    const federation = screen.getByTestId('ops-tab-federation');

    expect(overview).toHaveAttribute('tabIndex', '0');
    expect(jobs).toHaveAttribute('tabIndex', '-1');
    expect(triggers).toHaveAttribute('tabIndex', '-1');
    expect(devices).toHaveAttribute('tabIndex', '-1');
    expect(federation).toHaveAttribute('tabIndex', '-1');

    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(jobs).toHaveFocus();
    await waitFor(() => expect(jobs).toHaveAttribute('aria-selected', 'true'));
    expect(overview).toHaveAttribute('tabIndex', '-1');
    expect(jobs).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(jobs, { key: 'ArrowRight' });
    expect(triggers).toHaveFocus();

    fireEvent.keyDown(triggers, { key: 'ArrowRight' });
    expect(devices).toHaveFocus();

    fireEvent.keyDown(devices, { key: 'ArrowRight' });
    expect(federation).toHaveFocus();

    fireEvent.keyDown(federation, { key: 'ArrowRight' });
    expect(overview).toHaveFocus(); // wraps past the last tab

    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(federation).toHaveFocus(); // wraps before the first tab
  });

  it('Home jumps to the first tab, End to the last', async () => {
    renderAt('/ops');
    const overview = await screen.findByTestId('ops-tab-overview');
    const federation = screen.getByTestId('ops-tab-federation');

    overview.focus();
    fireEvent.keyDown(overview, { key: 'End' });
    expect(federation).toHaveFocus();
    await waitFor(() =>
      expect(federation).toHaveAttribute('aria-selected', 'true'),
    );

    fireEvent.keyDown(federation, { key: 'Home' });
    expect(overview).toHaveFocus();
    await waitFor(() =>
      expect(overview).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('links each tab to its panel via aria-controls/id/role=tabpanel', async () => {
    renderAt('/ops');
    const overviewTab = await screen.findByTestId('ops-tab-overview');
    expect(overviewTab).toHaveAttribute('aria-controls', 'ops-panel-overview');
    expect(screen.getByTestId('ops-panel-overview')).toHaveAttribute(
      'role',
      'tabpanel',
    );
    expect(screen.getByTestId('ops-panel-overview')).toHaveAttribute(
      'aria-labelledby',
      'ops-tab-overview',
    );
  });
});
