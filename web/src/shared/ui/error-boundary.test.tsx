import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegionErrorBoundary } from './error-boundary.tsx';

function Boom(): never {
  throw new Error('kaboom');
}

describe('RegionErrorBoundary', () => {
  it('renders children normally', () => {
    render(
      <RegionErrorBoundary region="Chat">
        <span>ok</span>
      </RegionErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('catches a throwing child and shows a region-scoped fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RegionErrorBoundary region="Chat">
        <Boom />
      </RegionErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Chat/);
  });
});
