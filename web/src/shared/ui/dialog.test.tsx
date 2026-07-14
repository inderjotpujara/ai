import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog.tsx';

describe('Dialog', () => {
  it('renders its title and content when open', () => {
    render(
      <Dialog open title="Palette" onOpenChange={vi.fn()}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByText('Palette')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Palette" onOpenChange={vi.fn()}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });
});
