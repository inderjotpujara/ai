import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('defaults to the Agent wizard and can switch to Crew/Workflow', async () => {
    renderAt('/builders');
    expect(await screen.findByTestId('area-builders')).toBeInTheDocument();
    expect(screen.getByText('Agent Builder')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('builders-mode-crew'));

    expect(
      await screen.findByText('Crew / Workflow Builder'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('builder-wizard-crew'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Agent Builder')).not.toBeInTheDocument();
  });

  it('moves focus with ArrowRight/ArrowLeft (roving tabindex, wrapping) and links each tab to its panel (D2)', async () => {
    renderAt('/builders');
    const agent = await screen.findByTestId('builders-mode-agent');
    const crew = screen.getByTestId('builders-mode-crew');

    expect(agent).toHaveAttribute('tabIndex', '0');
    expect(crew).toHaveAttribute('tabIndex', '-1');
    expect(agent).toHaveAttribute('aria-controls', 'builders-panel-agent');
    expect(screen.getByTestId('builders-panel-agent')).toHaveAttribute(
      'role',
      'tabpanel',
    );

    agent.focus();
    fireEvent.keyDown(agent, { key: 'ArrowRight' });
    expect(crew).toHaveFocus();

    fireEvent.keyDown(crew, { key: 'ArrowRight' });
    expect(agent).toHaveFocus(); // wraps — only 2 tabs
  });
});
