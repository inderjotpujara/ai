import { StepKind } from '@contracts';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let lastProps: Record<string, unknown> | undefined;

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      lastProps = props;
      return <div data-testid="mock-reactflow" />;
    },
  };
});

import { DagView } from './dag-view.tsx';
import type { DagModel } from './types.ts';

const model: DagModel = {
  nodes: [{ id: 'a', label: 'a', kind: StepKind.Tool }],
  edges: [],
};

describe('DagView — reduced motion (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastProps = undefined;
  });

  it('passes a zero fitViewOptions.duration when prefers-reduced-motion is set', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<DagView model={model} />);
    expect(lastProps?.fitViewOptions).toEqual({ duration: 0 });
  });

  it('passes a non-zero fitViewOptions.duration when reduced motion is off', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<DagView model={model} />);
    expect(
      (lastProps?.fitViewOptions as { duration: number }).duration,
    ).toBeGreaterThan(0);
  });
});
