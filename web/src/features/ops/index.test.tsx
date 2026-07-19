import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('OpsArea', () => {
  it('renders the Ops shell with four tabs, defaulting to Overview', async () => {
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
});
