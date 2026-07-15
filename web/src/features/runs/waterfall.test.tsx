import type { SpanDTO } from '@contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Waterfall } from './waterfall.tsx';

function span(p: Partial<SpanDTO> & { spanId: string }): SpanDTO {
  return {
    parentSpanId: null,
    name: p.spanId,
    offsetMs: 0,
    durationMs: 10,
    depth: 0,
    status: 'ok' as SpanDTO['status'],
    degraded: false,
    attributes: {},
    events: [],
    ...p,
  };
}

describe('Waterfall', () => {
  it('renders one bar per span, positioned by offset/duration', () => {
    render(
      <Waterfall
        spans={[
          span({ spanId: 'a', offsetMs: 0, durationMs: 10 }),
          span({ spanId: 'b', offsetMs: 10, durationMs: 10 }),
        ]}
      />,
    );
    const a = screen.getByTestId('bar-a');
    const b = screen.getByTestId('bar-b');
    expect(Number(b.getAttribute('x'))).toBeGreaterThan(
      Number(a.getAttribute('x')),
    );
  });

  it('colours error spans with the danger token', () => {
    render(
      <Waterfall
        spans={[span({ spanId: 'e', status: 'error' as SpanDTO['status'] })]}
      />,
    );
    expect(screen.getByTestId('bar-e').getAttribute('fill')).toContain(
      '--color-danger',
    );
  });

  it('opens the span-detail panel on bar click', () => {
    render(<Waterfall spans={[span({ spanId: 'a', name: 'agent.run' })]} />);
    expect(screen.queryByTestId('span-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('bar-a'));
    expect(screen.getByTestId('span-detail')).toHaveTextContent('agent.run');
  });
});
