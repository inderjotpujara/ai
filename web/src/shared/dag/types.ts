import type { StepKind } from '@contracts';

/** A DagView node's kind — every StepKind value plus 'manager' (D7a's
 *  hierarchical-crew hub node, which has no StepKind analog). */
export type DagNodeKind = StepKind | 'manager';

/** Live overlay status for a node (run-detail's D8 join); undefined/omitted
 *  renders as the neutral/default (pending) look. `Proposed` (Phase 5, D6) is
 *  distinct from `Pending`: a proposed node is a staged, not-yet-committed
 *  builder proposal, not a step waiting its turn in an active run. */
export enum DagStatus {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Skipped = 'skipped',
  Proposed = 'proposed',
}

export type DagNode = {
  id: string;
  label: string;
  sublabel?: string;
  kind: DagNodeKind;
  status?: DagStatus;
};

/** 'delegates' is the D7a hierarchical-crew manager→member edge; the other
 *  three kinds mirror `EdgeDTO['kind']` verbatim. */
export type DagEdgeKind =
  | 'depends'
  | 'branch-true'
  | 'branch-false'
  | 'delegates';

export type DagEdge = {
  from: string;
  to: string;
  kind: DagEdgeKind;
};

/** The normalized graph every DagView producer (workflow-graph, crew-graph,
 *  the run-detail live overlay) builds — D7's "one generic DagView". */
export type DagModel = {
  nodes: DagNode[];
  edges: DagEdge[];
};
