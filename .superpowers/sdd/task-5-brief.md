### Task 5: Gate `DagView`'s `fitView` animation via `useReducedMotion` (D3)

**Files:**
- Modify: `web/src/shared/dag/dag-view.tsx` (import the hook; add `fitViewOptions` to the `<ReactFlow>` element at line 138)
- Create: `web/src/shared/dag/dag-view.reduced-motion.test.tsx` (a separate file from the existing `dag-view.test.tsx` — mocks `@xyflow/react`'s `ReactFlow` export to capture props, which the existing full-render tests must NOT be affected by)

**Interfaces:**
- Consumes: `useReducedMotion` (Task 4).
- Produces: no change to `DagView`'s public props (`model`/`statusById`/`onNodeClick` unchanged) — internal only: `<ReactFlow fitViewOptions={{ duration: reducedMotion ? 0 : 200 }}>`.

- [ ] **Step 1: Write the failing test**

Create `web/src/shared/dag/dag-view.reduced-motion.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- dag/dag-view.reduced-motion.test.tsx`
Expected: FAIL — `DagView` doesn't pass a `fitViewOptions` prop yet (`lastProps?.fitViewOptions` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/shared/dag/dag-view.tsx` — add the import and use the hook:

```tsx
import { useReducedMotion } from '../a11y/use-reduced-motion.ts';
```

```tsx
export function DagView({
  model,
  statusById,
  onNodeClick,
}: {
  model: DagModel;
  statusById?: Record<string, DagStatus>;
  onNodeClick?: (nodeId: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const { nodes, edges } = useMemo(() => {
```

```tsx
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ duration: reducedMotion ? 0 : 200 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={
          onNodeClick ? (_event, node) => onNodeClick(node.id) : undefined
        }
      >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- dag/dag-view.reduced-motion.test.tsx dag/dag-view.test.tsx`
Expected: PASS on both files — the pre-existing `dag-view.test.tsx` is unaffected since its `vi.mock` scope is per-file, not global.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/dag/dag-view.tsx web/src/shared/dag/dag-view.reduced-motion.test.tsx
git commit -m "feat(a11y): gate DagView's fitView animation via useReducedMotion (D3)"
```

---

