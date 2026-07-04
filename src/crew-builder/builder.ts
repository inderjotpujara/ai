// src/crew-builder/builder.ts
import type { ValidationIssue } from '../agent-builder/types.ts';
import { withCrewBuildSpan } from '../telemetry/spans.ts';
import { analyzeNeed } from './analyze.ts';
import { classifyNeed } from './classify.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';
import { planEdges } from './plan-edges.ts';
import { planNodes } from './plan-nodes.ts';
import { referencedAgents, resolveMissingAgents } from './resolve-members.ts';
import { transpile } from './transpile.ts';
import type { CrewBuilderDeps, CrewBuildResult, Shape } from './types.ts';
import { validateIR } from './validate.ts';
import { writeCrewOrWorkflow } from './write.ts';

const MAX_REGENERATIONS = 1;

type Rec = {
  event: (
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ) => void;
  outcome: (
    kind: string,
    shape?: string,
    id?: string,
    memberOrStepCount?: number,
    membersBuilt?: number,
  ) => void;
};

/** Render the consent prompt: the proposed IR's shape/tasks-or-steps, the
 *  new agents that will be built (if any), and the files it will write. */
function renderSummary(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  planned: string[],
): string {
  const head = `Proposed ${shape} "${ir.id}"${ir.description ? ` — ${ir.description}` : ''}`;
  const body =
    shape === 'crew'
      ? (ir as CrewIR).tasks
          .map((t) => `  • ${t.member}: ${t.description}`)
          .join('\n')
      : (ir as WorkflowIR).steps
          .map((s) => `  • ${s.id} [${s.kind}]`)
          .join('\n');
  const built = planned.length
    ? `\nWill build new agents: ${planned.join(', ')}`
    : '';
  const files =
    shape === 'crew'
      ? `crews/${ir.id}.ts, crews/index.ts`
      : `workflows/${ir.id}.ts, workflows/index.ts`;
  return `${head}\n${body}${built}\nFiles: ${files}`;
}

function memberOrStepCount(ir: CrewIR | WorkflowIR, shape: Shape): number {
  return shape === 'crew'
    ? (ir as CrewIR).members.length
    : (ir as WorkflowIR).steps.length;
}

function finish(
  rec: Rec,
  shape: Shape,
  result: CrewBuildResult,
  ir?: CrewIR | WorkflowIR,
): CrewBuildResult {
  if (result.kind === 'written') {
    const count = ir ? memberOrStepCount(ir, shape) : undefined;
    rec.outcome(
      'written',
      shape,
      result.name,
      count,
      result.builtAgents.length,
    );
  } else {
    rec.outcome(result.kind, shape);
  }
  return result;
}

/** Orchestrates the crew/workflow-builder end to end: classify the need's
 *  shape, analyze it into a prose plan, generate+validate an IR (with one
 *  bounded regeneration), get consent on a rendered summary, THEN build any
 *  missing agents and rewrite the IR's refs to their actual built names, and
 *  finally transpile+write.
 *
 *  Building happens once, AFTER consent — never inside the regeneration
 *  loop. `resolveMissingAgents`'s "already built?" check reads
 *  `deps.existingAgents()`, an in-memory registry snapshot that doesn't pick
 *  up an agent written to disk mid-run (only on next process start). Calling
 *  it per attempt would re-build the same agent on every retry. Instead, the
 *  loop only computes which agents WOULD need building (`referencedAgents`
 *  minus `existingAgents()`) so validation's `toBeBuilt` can treat them as
 *  known — the actual build happens exactly once, after the user has
 *  consented to the plan. */
export function buildCrewOrWorkflow(
  need: string,
  deps: CrewBuilderDeps,
): Promise<CrewBuildResult> {
  return withCrewBuildSpan(need, async (rec) => {
    const shape = await classifyNeed(need, deps.model);
    rec.event('classified', { shape });

    const analysis = await analyzeNeed(need, shape, deps.model);
    rec.event('analyzed');

    let ir: CrewIR | WorkflowIR | undefined;
    let issues: ValidationIssue[] = [];
    let planned: string[] = [];
    for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
      const nodes = await planNodes(
        need,
        shape,
        analysis,
        deps.model,
        deps.packNames(),
      );
      ir = await planEdges(need, shape, analysis, nodes, deps.model);
      rec.event('generated', { attempt });

      const existing = new Set(deps.existingAgents());
      planned = referencedAgents(ir, shape).filter((n) => !existing.has(n));

      issues = await validateIR(
        ir,
        shape,
        {
          existingAgents: deps.existingAgents(),
          packNames: deps.packNames(),
          toBeBuilt: planned,
          model: deps.model,
        },
        need,
      );
      rec.event('validated', { attempt, issues: issues.length });
      if (issues.length === 0) break;
    }
    if (!ir || issues.length > 0)
      return finish(rec, shape, { kind: 'invalid', issues });

    const granted = await deps.confirm(renderSummary(ir, shape, planned));
    if (!granted) return finish(rec, shape, { kind: 'declined' });

    const resolved = await resolveMissingAgents(ir, shape, deps);
    if (resolved.abandoned)
      return finish(rec, shape, {
        kind: 'abandoned',
        reason: resolved.abandoned,
      });

    const source = transpile(resolved.ir, shape);
    const files = writeCrewOrWorkflow(
      resolved.ir.id,
      source,
      shape,
      deps.paths,
    );
    rec.event('written');
    return finish(
      rec,
      shape,
      {
        kind: 'written',
        shape,
        name: resolved.ir.id,
        files,
        builtAgents: resolved.builtAgents,
      },
      resolved.ir,
    );
  });
}
