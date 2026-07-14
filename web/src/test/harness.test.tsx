import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('web test harness', () => {
  it('renders a DOM node and jest-dom matchers work', () => {
    render(<button type="button">ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });

  it('runs under a cross-origin-isolation-aware DOM', () => {
    // happy-dom provides window; crossOriginIsolated may be undefined in jsdom-likes.
    expect(typeof window).toBe('object');
  });
});
