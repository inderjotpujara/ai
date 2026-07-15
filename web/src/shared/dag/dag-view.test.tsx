import { StepKind } from '@contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DagView } from './dag-view.tsx';
import { type DagModel, DagStatus } from './types.ts';

const model: DagModel = {
  nodes: [
    { id: 'a', label: 'a', kind: StepKind.Tool },
    { id: 'b', label: 'b', kind: StepKind.Agent },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'depends' }],
};

describe('DagView', () => {
  it('renders a node per graph node', () => {
    render(<DagView model={model} />);
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    expect(screen.getByTestId('dag-node-a')).toBeInTheDocument();
    expect(screen.getByTestId('dag-node-b')).toBeInTheDocument();
  });

  it('overlays statusById onto the matching node (border reflects status)', () => {
    render(<DagView model={model} statusById={{ a: DagStatus.Error }} />);
    // Asserts the inline style declaration directly rather than via
    // `toHaveStyle` (which reads `getComputedStyle`): happy-dom's computed-
    // style engine substitutes unresolved `var(--x)` references with '' (no
    // matching custom property is registered in this test DOM), so the
    // literal token string never survives to computed style — see
    // CSSStyleDeclarationComputedStyle's `parseCSSVariablesInValue`. The
    // inline declaration (`element.style`) is unaffected by that resolution
    // and reflects exactly what DagNodeCard set, which is what this test
    // means to check.
    expect(screen.getByTestId('dag-node-a').style.borderColor).toBe(
      'var(--color-danger)',
    );
  });

  it('calls onNodeClick with the clicked node id', () => {
    const onNodeClick = vi.fn();
    render(<DagView model={model} onNodeClick={onNodeClick} />);
    fireEvent.click(screen.getByTestId('dag-node-a'));
    expect(onNodeClick).toHaveBeenCalledWith('a');
  });

  it('shows an empty state for a graph with no nodes', () => {
    render(<DagView model={{ nodes: [], edges: [] }} />);
    expect(screen.getByTestId('dag-empty')).toBeInTheDocument();
  });
});
