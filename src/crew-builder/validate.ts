import { z } from 'zod';
import type { BuilderModel, ValidationIssue } from '../agent-builder/types.ts';
import { assertAcyclic } from '../workflow/define.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';
import type { Shape } from './types.ts';

export type ValidateCtx = {
  existingAgents: string[];
  packNames: string[];
  toBeBuilt: string[]; // agent names that WILL be built this run — valid refs too
  model: BuilderModel;
};

const AlignSchema = z.object({ aligned: z.boolean(), reason: z.string() });

/** Collect every fromStep/predicate/map ref a workflow step names. `dependsOn`
 *  is deliberately excluded here — the acyclicity gate below resolves and
 *  checks those edges (mirrors `effectiveDeps`). */
function refsOf(step: WorkflowIR['steps'][number]): string[] {
  const out: string[] = [];
  if ('input' in step && step.input.kind === 'fromStep')
    out.push(step.input.ref);
  if (step.kind === 'branch') out.push(step.predicate.ref);
  if (step.kind === 'map') {
    out.push(step.over.ref);
    if (step.step.input.kind === 'fromStep') out.push(step.step.input.ref);
  }
  return out;
}

/** Effective dependency edges for a workflow IR's steps, mirroring
 *  `effectiveDeps` (src/workflow/types.ts): explicit `dependsOn`, else the
 *  previous step in declaration order. Feeds `assertAcyclic` directly. */
function workflowEdges(steps: WorkflowIR['steps']): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  steps.forEach((step, i) => {
    const prev = steps[i - 1];
    const deps = step.dependsOn ?? (prev ? [prev.id] : []);
    for (const dep of deps) edges.push([dep, step.id]);
  });
  return edges;
}

/** Effective dependency edges for a crew IR's tasks, mirroring
 *  `effectiveTaskDeps` (src/crew/define.ts). */
function crewTaskEdges(tasks: CrewIR['tasks']): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  tasks.forEach((task, i) => {
    const prev = tasks[i - 1];
    const deps = task.dependsOn ?? (prev ? [prev.id] : []);
    for (const dep of deps) edges.push([dep, task.id]);
  });
  return edges;
}

function structuralWorkflow(
  ir: WorkflowIR,
  ctx: ValidateCtx,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set([...ctx.existingAgents, ...ctx.toBeBuilt]);

  const seen = new Set<string>();
  for (const step of ir.steps) {
    if (seen.has(step.id)) {
      issues.push({ field: 'id', problem: `duplicate step id "${step.id}"` });
    }
    seen.add(step.id);
  }
  const ids = new Set(ir.steps.map((s) => s.id));

  for (const step of ir.steps) {
    if (step.kind === 'agent' && !known.has(step.agent)) {
      issues.push({
        field: 'agent',
        problem: `step ${step.id} references unknown agent "${step.agent}"`,
      });
    }
    if (step.kind === 'tool' && !ctx.packNames.includes(step.tool)) {
      issues.push({
        field: 'tool',
        problem: `step ${step.id} uses tool "${step.tool}" not in the palette`,
      });
    }
    for (const ref of refsOf(step)) {
      if (!ids.has(ref)) {
        issues.push({
          field: 'ref',
          problem: `step ${step.id} references unknown step "${ref}"`,
        });
      }
    }
    if (step.kind === 'branch') {
      for (const target of [step.whenTrue, step.whenFalse]) {
        if (!ids.has(target)) {
          issues.push({
            field: 'branch',
            problem: `branch ${step.id} target "${target}" is unknown`,
          });
        }
      }
    }
  }

  try {
    assertAcyclic([...ids], workflowEdges(ir.steps));
  } catch (e) {
    issues.push({
      field: 'graph',
      problem: `workflow ${ir.id}: ${(e as Error).message}`,
    });
  }

  return issues;
}

function structuralCrew(ir: CrewIR, ctx: ValidateCtx): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set([...ctx.existingAgents, ...ctx.toBeBuilt]);

  const memberNames = new Set<string>();
  for (const m of ir.members) {
    if (memberNames.has(m.name)) {
      issues.push({
        field: 'member',
        problem: `duplicate member name "${m.name}"`,
      });
    }
    memberNames.add(m.name);
    if (m.agentRef && !known.has(m.agentRef)) {
      issues.push({
        field: 'agentRef',
        problem: `member ${m.name} references unknown agent "${m.agentRef}"`,
      });
    }
    for (const t of m.tools ?? []) {
      if (!ctx.packNames.includes(t)) {
        issues.push({
          field: 'tools',
          problem: `member ${m.name} tool "${t}" not in the palette`,
        });
      }
    }
  }

  const taskIds = new Set<string>();
  for (const t of ir.tasks) {
    if (taskIds.has(t.id)) {
      issues.push({ field: 'id', problem: `duplicate task id "${t.id}"` });
    }
    taskIds.add(t.id);
    if (!memberNames.has(t.member)) {
      issues.push({
        field: 'member',
        problem: `task ${t.id} references unknown member "${t.member}"`,
      });
    }
  }

  try {
    assertAcyclic([...taskIds], crewTaskEdges(ir.tasks));
  } catch (e) {
    issues.push({
      field: 'graph',
      problem: `crew ${ir.id}: ${(e as Error).message}`,
    });
  }

  return issues;
}

/** Tier 2: does the graph actually accomplish the stated need? A lightweight
 *  LLM-judge call — only ever reached once the structural tier is clean. */
async function goalAlignment(
  need: string,
  ir: CrewIR | WorkflowIR,
  model: BuilderModel,
): Promise<ValidationIssue[]> {
  const prompt = [
    'Does the plan below actually accomplish the stated need?',
    'Answer as JSON: { "aligned": boolean, "reason": string }.',
    `Need: ${need}`,
    `Plan: ${JSON.stringify(ir)}`,
  ].join('\n');
  const { aligned, reason } = await model.object({
    schema: AlignSchema,
    prompt,
  });
  if (aligned) return [];
  return [
    {
      field: 'goal-alignment',
      problem: reason || 'graph does not accomplish the need',
    },
  ];
}

/** Two-tier IR validation gate.
 *  Tier 1 STRUCTURAL (sync): agent refs resolve to existingAgents ∪ toBeBuilt,
 *  tool refs are palette-only, every fromStep/predicate/map ref names a real
 *  upstream step, branch targets exist, member `agentRef` resolves, and the
 *  dependency graph is id-unique + acyclic (`assertAcyclic`).
 *  Tier 2 SEMANTIC (async): an LLM-judge goal-alignment check, reached only
 *  when tier 1 found nothing — a structurally-broken graph never spends a
 *  model call. Empty array = valid. */
export async function validateIR(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  ctx: ValidateCtx,
  need = '',
): Promise<ValidationIssue[]> {
  const issues =
    shape === 'workflow'
      ? structuralWorkflow(ir as WorkflowIR, ctx)
      : structuralCrew(ir as CrewIR, ctx);
  if (issues.length > 0) return issues; // don't spend a model call on a structurally-broken graph
  return goalAlignment(need, ir, ctx.model);
}
