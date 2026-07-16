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
});
