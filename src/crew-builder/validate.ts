import { z } from 'zod';
import type { BuilderModel, ValidationIssue } from '../agent-builder/types.ts';
import { assertAcyclic } from '../workflow/define.ts';
import type { CrewIR, InputDescriptor, WorkflowIR } from './ir.ts';
import type { Shape } from './types.ts';

/** Same placeholder regex as `fromTemplate` (safe-helpers.ts) — kept in sync
 *  so every `{{ref}}` a template can resolve is also a ref we validate. */
const TEMPLATE_REF_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Same snake_case pattern write.ts enforces at write time (single
 *  underscores only, no leading/trailing/repeated `_`). Checking it here
 *  too means a malformed `ir.id` is caught by the structural tier — and
 *  surfaced as a retryable validation issue — before consent+write ever
 *  sees it, instead of throwing deep inside `writeCrewOrWorkflow`. */
const ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Refs named by a single input descriptor: a `fromStep` ref, or every
 *  `{{ref}}` placeholder embedded in a `fromTemplate` template. */
function refsOfInput(input: InputDescriptor): string[] {
  if (input.kind === 'fromStep') return [input.ref];
  if (input.kind === 'fromTemplate')
    return [...input.template.matchAll(TEMPLATE_REF_RE)]
      .map((m) => m[1])
      .filter((ref): ref is string => ref !== undefined);
  return [];
}

export type ValidateCtx = {
  existingAgents: string[];
  packNames: string[];
  toBeBuilt: string[]; // agent names that WILL be built this run — valid refs too
  model: BuilderModel;
};

const AlignSchema = z.object({ aligned: z.boolean(), reason: z.string() });

/** Collect every fromStep/fromTemplate/predicate/map ref a workflow step
 *  names — including a map step's inner sub-step input. `dependsOn` is
 *  deliberately excluded here — the acyclicity gate below resolves and
 *  checks those edges (mirrors `effectiveDeps`). */
function refsOf(step: WorkflowIR['steps'][number]): string[] {
  const out: string[] = [];
  if ('input' in step) out.push(...refsOfInput(step.input));
  if (step.kind === 'branch') out.push(step.predicate.ref);
  if (step.kind === 'map') {
    out.push(step.over.ref);
    out.push(...refsOfInput(step.step.input));
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

  if (!ID_PATTERN.test(ir.id)) {
    issues.push({
      field: 'id',
      problem: `crew/workflow id "${ir.id}" must be snake_case (single underscores)`,
    });
  }

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
    if (step.kind === 'map') {
      if (step.step.kind === 'agent' && !known.has(step.step.agent)) {
        issues.push({
          field: 'agent',
          problem: `step ${step.id} references unknown agent "${step.step.agent}"`,
        });
      }
      if (
        step.step.kind === 'tool' &&
        !ctx.packNames.includes(step.step.tool)
      ) {
        issues.push({
          field: 'tool',
          problem: `step ${step.id} uses tool "${step.step.tool}" not in the palette`,
        });
      }
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

  if (!ID_PATTERN.test(ir.id)) {
    issues.push({
      field: 'id',
      problem: `crew/workflow id "${ir.id}" must be snake_case (single underscores)`,
    });
  }

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

/** Tier 1 alone (sync, no model call): agent refs resolve to existingAgents ∪
 *  toBeBuilt (including a map step's inner sub-step agent), tool refs are
 *  palette-only (ditto for a map sub-step tool), every
 *  fromStep/fromTemplate/predicate/map ref names a real upstream step, branch
 *  targets exist, member `agentRef` resolves, and the dependency graph is
 *  id-unique + acyclic (`assertAcyclic`). Exported so the verify-then-commit
 *  gate (verified-build) can re-check a staged IR's structure without paying
 *  for another goal-alignment model call. */
export function validateStructural(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  ctx: ValidateCtx,
): ValidationIssue[] {
  return shape === 'workflow'
    ? structuralWorkflow(ir as WorkflowIR, ctx)
    : structuralCrew(ir as CrewIR, ctx);
}

/** Two-tier IR validation gate.
 *  Tier 1 STRUCTURAL (sync): see `validateStructural`.
 *  Tier 2 SEMANTIC (async): an LLM-judge goal-alignment check, reached only
 *  when tier 1 found nothing — a structurally-broken graph never spends a
 *  model call. Empty array = valid. */
export async function validateIR(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  ctx: ValidateCtx,
  need = '',
): Promise<ValidationIssue[]> {
  const issues = validateStructural(ir, shape, ctx);
  if (issues.length > 0) return issues; // don't spend a model call on a structurally-broken graph
  return goalAlignment(need, ir, ctx.model);
}
