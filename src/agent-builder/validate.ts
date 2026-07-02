import type { AgentProposal, ValidationIssue } from './types.ts';

const SNAKE = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(['super', 'orchestrator']);

/** Structural gate. Palette-only tools + unique snake_case name + non-empty
 *  fields + each server scoped to this agent. No LLM, no I/O. */
export function validateProposal(
  p: AgentProposal,
  existingNames: string[],
  packNames: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!SNAKE.test(p.name)) {
    issues.push({
      field: 'name',
      problem: `"${p.name}" is not snake_case ([a-z][a-z0-9_]*)`,
    });
  } else if (RESERVED.has(p.name) || existingNames.includes(p.name)) {
    issues.push({
      field: 'name',
      problem: `"${p.name}" is reserved or already exists`,
    });
  }
  if (p.description.trim().length === 0) {
    issues.push({ field: 'description', problem: 'description is empty' });
  }
  if (p.systemPrompt.trim().length === 0) {
    issues.push({ field: 'systemPrompt', problem: 'systemPrompt is empty' });
  }
  for (const s of p.suggestedServers) {
    if (!packNames.includes(s.packName)) {
      issues.push({
        field: 'suggestedServers',
        problem: `"${s.packName}" is not in the curated pack (palette-only)`,
      });
    }
    if (s.scopeToAgent !== p.name) {
      issues.push({
        field: 'suggestedServers',
        problem: `"${s.packName}" must be scoped to "${p.name}", not "${s.scopeToAgent}"`,
      });
    }
  }
  return issues;
}
