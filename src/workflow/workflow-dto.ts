import type {
  EdgeDTO,
  StepDTO,
  StepKind,
  WorkflowDetailDTO,
  WorkflowListItemDTO,
} from '../contracts/index.ts';
import {
  type BranchStep,
  StepKind as EngineStepKind,
  effectiveDeps,
  type MapStep,
  type Step,
  type WorkflowDef,
} from './types.ts';

function onErrorLabel(step: Step): string | undefined {
  const oe = step.onError;
  if (oe === undefined) return undefined;
  return typeof oe === 'string' ? oe : 'fallback';
}

function mapStep(step: Step): StepDTO {
  const base: StepDTO = {
    id: step.id,
    kind: step.kind as unknown as StepKind,
    ...(onErrorLabel(step) !== undefined
      ? { onError: onErrorLabel(step) }
      : {}),
    ...(step.retry !== undefined ? { retry: step.retry } : {}),
  };
  if (step.kind === EngineStepKind.Agent) {
    base.agent = step.agent;
    if (step.verify !== undefined) base.verify = step.verify;
  } else if (step.kind === EngineStepKind.Tool) {
    base.tool = step.tool;
  } else if (step.kind === EngineStepKind.Branch) {
    const b = step as BranchStep;
    base.branch = { whenTrue: b.whenTrue, whenFalse: b.whenFalse };
  } else if (step.kind === EngineStepKind.Map) {
    const m = step as MapStep;
    base.map = { subKind: m.step.kind as unknown as StepKind };
  }
  return base;
}

function deriveEdges(steps: Step[]): EdgeDTO[] {
  const edges: EdgeDTO[] = [];
  steps.forEach((step, i) => {
    for (const dep of effectiveDeps(step, i, steps)) {
      edges.push({ from: dep, to: step.id, kind: 'depends' });
    }
    if (step.kind === EngineStepKind.Branch) {
      const b = step as BranchStep;
      edges.push({ from: b.id, to: b.whenTrue, kind: 'branch-true' });
      edges.push({ from: b.id, to: b.whenFalse, kind: 'branch-false' });
    }
  });
  return edges;
}

export function mapWorkflowToListItem(def: WorkflowDef): WorkflowListItemDTO {
  return {
    id: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    stepCount: def.steps.length,
  };
}

export function mapWorkflowToDetail(def: WorkflowDef): WorkflowDetailDTO {
  return {
    id: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    steps: def.steps.map(mapStep),
    edges: deriveEdges(def.steps),
  };
}
