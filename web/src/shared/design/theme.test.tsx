import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Theme, ThemeProvider, toggleThemeGlobal, useTheme } from './theme.tsx';

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      theme:{theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('ThemeProvider', () => {
  it('defaults to dark when no stored value and OS is not light', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
  });

  it('toggles to light, applies the class, and persists', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('agent-theme')).toBe(Theme.Light);
  });

  it('restores the persisted theme on mount', () => {
    localStorage.setItem('agent-theme', Theme.Light);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
  });

  it('toggleThemeGlobal (D8 action command) flips DOM class + storage and resyncs a mounted ThemeProvider without a direct hook call', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark');

    toggleThemeGlobal();

    expect(document.documentElement).toHaveClass('light');
    expect(localStorage.getItem('agent-theme')).toBe(Theme.Light);
    expect(screen.getByRole('button')).toHaveTextContent('theme:light');
  });
});
