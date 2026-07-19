import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('LibraryArea', () => {
  it('defaults to the Models tab and switches to Memory/MCP on click', async () => {
    renderAt('/library');
    expect(await screen.findByTestId('area-library')).toBeInTheDocument();
    expect(screen.getByTestId('library-panel-models')).toBeInTheDocument();
    expect(screen.getByTestId('library-tab-models')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(screen.getByTestId('library-tab-memory'));
    expect(screen.getByTestId('library-panel-memory')).toBeInTheDocument();
    expect(
      screen.queryByTestId('library-panel-models'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-tab-mcp'));
    expect(screen.getByTestId('library-panel-mcp')).toBeInTheDocument();
  });

  it('moves focus with ArrowRight/ArrowLeft (roving tabindex), wrapping at the ends (D2)', async () => {
    renderAt('/library');
    const models = await screen.findByTestId('library-tab-models');
    const memory = screen.getByTestId('library-tab-memory');
    const mcp = screen.getByTestId('library-tab-mcp');

    expect(models).toHaveAttribute('tabIndex', '0');
    expect(memory).toHaveAttribute('tabIndex', '-1');

    models.focus();
    fireEvent.keyDown(models, { key: 'ArrowRight' });
    expect(memory).toHaveFocus();
    expect(screen.getByTestId('library-panel-memory')).toBeInTheDocument();

    fireEvent.keyDown(memory, { key: 'ArrowRight' });
    expect(mcp).toHaveFocus();

    fireEvent.keyDown(mcp, { key: 'ArrowRight' });
    expect(models).toHaveFocus(); // wraps past the last tab
  });

  it('links each tab to its panel via aria-controls/id/role=tabpanel (D2)', async () => {
    renderAt('/library');
    const modelsTab = await screen.findByTestId('library-tab-models');
    expect(modelsTab).toHaveAttribute('aria-controls', 'library-panel-models');
    expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
      'role',
      'tabpanel',
    );
    expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
      'aria-labelledby',
      'library-tab-models',
    );
  });
});
