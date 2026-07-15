import {
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
// `base.css` (not `style.css`) — the minimal reset only; DagView's colors/
// borders are all our own inline styles via design tokens, not xyflow's
// default theme.
import '@xyflow/react/dist/base.css';
import { useMemo } from 'react';
import { layeredPositions } from './layout.ts';
import { type DagModel, type DagNodeKind, DagStatus } from './types.ts';

function statusColor(status: DagStatus | undefined): string | undefined {
  switch (status) {
    case DagStatus.Running:
      return 'var(--color-accent)';
    case DagStatus.Done:
      return 'var(--color-signal)';
    case DagStatus.Error:
      return 'var(--color-danger)';
    case DagStatus.Skipped:
      return 'var(--color-muted)';
    default:
      return undefined;
  }
}

function kindColor(kind: DagNodeKind): string {
  return kind === 'manager' ? 'var(--color-accent)' : 'var(--color-border)';
}

type DagNodeData = {
  label: string;
  sublabel?: string;
  kind: DagNodeKind;
  status?: DagStatus;
};

// NOTE: `NodeProps<Node<DagNodeData>>` matches @xyflow/react v12's custom-node
// typing; if a later ^12 minor shifts this generic shape, adjust to match —
// the runtime contract (a `data` prop shaped like `DagNodeData`) won't change.
function DagNodeCard({ data }: NodeProps<Node<DagNodeData>>) {
  const border = statusColor(data.status) ?? kindColor(data.kind);
  return (
    <div
      data-testid={`dag-node-${data.label}`}
      className="rounded-md border-2 bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-fg)]"
      style={{ borderColor: border }}
    >
      <Handle type="target" position={Position.Left} />
      <div>{data.label}</div>
      {data.sublabel && (
        <div className="text-[var(--color-muted)]">{data.sublabel}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { dag: DagNodeCard };

/**
 * D7's one generic step/task-graph canvas. Takes the normalized `DagModel`
 * (built by `workflowGraph`/`crewGraph`/the run-detail live overlay), lays it
 * out via `layeredPositions` (no dagre dependency), and renders it as an
 * interactive `@xyflow/react` canvas. `statusById` overlays a live status per
 * node id (D8); `onNodeClick` surfaces node selection (Task 17's step-detail
 * panel). Branch/delegate edges render dashed + labeled; depends edges
 * animate. Empty graphs render a plain empty state instead of a blank canvas.
 */
export function DagView({
  model,
  statusById,
  onNodeClick,
}: {
  model: DagModel;
  statusById?: Record<string, DagStatus>;
  onNodeClick?: (nodeId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const positions = layeredPositions(model);
    const rfNodes: Node<DagNodeData>[] = model.nodes.map((n) => ({
      id: n.id,
      type: 'dag',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        label: n.label,
        sublabel: n.sublabel,
        kind: n.kind,
        status: statusById?.[n.id] ?? n.status,
      },
    }));
    const rfEdges: Edge[] = model.edges.map((e) => ({
      id: `${e.from}-${e.to}-${e.kind}`,
      source: e.from,
      target: e.to,
      animated: e.kind === 'depends',
      style:
        e.kind === 'branch-true' ||
        e.kind === 'branch-false' ||
        e.kind === 'delegates'
          ? { strokeDasharray: '4 4' }
          : undefined,
      label:
        e.kind === 'branch-true'
          ? 'true'
          : e.kind === 'branch-false'
            ? 'false'
            : undefined,
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [model, statusById]);

  if (model.nodes.length === 0) {
    return (
      <div
        data-testid="dag-empty"
        role="status"
        className="p-4 font-mono text-sm text-[var(--color-muted)]"
      >
        No graph to show.
      </div>
    );
  }

  return (
    <div
      data-testid="dag-view"
      role="img"
      aria-label="step graph"
      style={{ width: '100%', height: 480 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={
          onNodeClick ? (_event, node) => onNodeClick(node.id) : undefined
        }
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
