import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render.tsx';

describe('tab widget keyboard pattern (D2, §6) — dedicated arrow-roving + tabpanel-linkage check', () => {
  it('Library: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/library');
    const models = await screen.findByTestId('library-tab-models');
    const memory = screen.getByTestId('library-tab-memory');
    const mcp = screen.getByTestId('library-tab-mcp');

    expect(models).toHaveAttribute('aria-controls', 'library-panel-models');
    expect(memory).toHaveAttribute('aria-controls', 'library-panel-memory');
    expect(mcp).toHaveAttribute('aria-controls', 'library-panel-mcp');
    expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
      'role',
      'tabpanel',
    );

    models.focus();
    fireEvent.keyDown(models, { key: 'ArrowRight' });
    expect(memory).toHaveFocus();
    fireEvent.keyDown(memory, { key: 'ArrowLeft' });
    expect(models).toHaveFocus();
  });

  it('Builders: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/builders');
    const agent = await screen.findByTestId('builders-mode-agent');
    const crew = screen.getByTestId('builders-mode-crew');

    expect(agent).toHaveAttribute('aria-controls', 'builders-panel-agent');
    expect(crew).toHaveAttribute('aria-controls', 'builders-panel-crew');

    agent.focus();
    fireEvent.keyDown(agent, { key: 'ArrowRight' });
    expect(crew).toHaveFocus();
    fireEvent.keyDown(crew, { key: 'ArrowRight' });
    expect(agent).toHaveFocus(); // wraps — only 2 tabs
  });
});
