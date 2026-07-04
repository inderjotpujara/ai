import type { ToolProposal, ValidationIssue } from './types.ts';

const SNAKE = /^[a-z][a-z0-9_]*$/;

/** Structural gate for a brand-new tool-code proposal — unique snake_case
 *  module name + non-empty fields + a sanity check that `code` actually
 *  defines a tool. No LLM, no I/O, and crucially NO execution of `code`: it
 *  is only pattern-checked here, exactly like `validateProposal` never runs
 *  the agent it validates. */
export function validateToolProposal(
  p: ToolProposal,
  existingModuleNames: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!SNAKE.test(p.name)) {
    issues.push({
      field: 'name',
      problem: `"${p.name}" is not snake_case ([a-z][a-z0-9_]*)`,
    });
  } else if (existingModuleNames.includes(p.name)) {
    issues.push({
      field: 'name',
      problem: `"${p.name}" already exists`,
    });
  }
  if (p.description.trim().length === 0) {
    issues.push({ field: 'description', problem: 'description is empty' });
  }
  if (p.code.trim().length === 0) {
    issues.push({ field: 'code', problem: 'code is empty' });
  } else if (!p.code.includes('tool(')) {
    issues.push({
      field: 'code',
      problem:
        'code does not define a tool() — expected the `ai` SDK tool() helper',
    });
  }
  return issues;
}
