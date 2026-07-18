import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { CommandPalette } from './command-palette.tsx';

describe('CommandPalette', () => {
  it('is hidden until ⌘K, then opens', async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('filters commands by typed text', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox'), 'runs');
    expect(screen.getByText(/Go to Runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/Go to Settings/i)).not.toBeInTheDocument();
  });

  it('runs the selected command on Enter and navigates', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox'), 'crews');
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith({ to: '/crews' });
  });

  it('closes on Escape', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('runs the selected command via runCommand (nav-kind, unchanged end-to-end behavior)', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox'), 'settings');
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' });
  });
});
