import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { TriggersTab } from './triggers-tab.tsx';

describe('TriggersTab', () => {
  it('renders the designed-but-stubbed empty-state', async () => {
    renderAt('/ops?tab=triggers');
    expect(await screen.findByTestId('ops-triggers')).toBeInTheDocument();
    expect(
      screen.getByText('Triggers arrive in Slice 25.'),
    ).toBeInTheDocument();
  });

  it('makes no network call — purely static content, rendered in isolation', () => {
    // Rendered standalone (no router/app-shell) so this only proves what
    // TriggersTab itself does — the full app shell fetches unrelated data
    // (e.g. the sessions sidebar) regardless of which Ops tab is active.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<TriggersTab />);
    expect(screen.getByTestId('ops-triggers')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
