import { withAgentBuildSpan } from '../telemetry/spans.ts';
import { generateProposal } from './generate.ts';
import { generateToolProposal } from './generate-tool.ts';
import { suggestServers } from './suggest-tools.ts';
import type {
  AgentProposal,
  BuilderDeps,
  BuildResult,
  ToolBuilderDeps,
  ToolBuildResult,
  ToolProposal,
  ValidationIssue,
} from './types.ts';
import { validateProposal } from './validate.ts';
import { validateToolProposal } from './validate-tool.ts';
import { writeAgent } from './write.ts';
import { writeToolProposal } from './write-tool.ts';

/** Bounded same-run regeneration (Task 24): on a structural-validation
 *  failure, feed the issues back to the model and try ONCE more before
 *  giving up. Never bypasses consent, never activates anything — it only
 *  widens the window before the (still consent-gated) proposal is shown to
 *  the user or rejected as invalid. */
const MAX_REGENERATIONS = 1;

/** Human-readable consent card for a proposal. */
export function renderProposal(p: AgentProposal): string {
  const servers = p.suggestedServers.length
    ? p.suggestedServers
        .map((s) => `  • ${s.packName} (scoped to ${s.scopeToAgent})`)
        .join('\n')
    : '  • (none)';
  return [
    `Proposed agent: ${p.name}`,
    `  ${p.description}`,
    `Why: ${p.rationale}`,
    `Tools (MCP servers to mount):`,
    servers,
    `Files that will be written: agents/${p.name}.ts, agents/index.ts` +
      (p.suggestedServers.length ? `, mcp.json` : ''),
  ].join('\n');
}

/** generate → suggest → validate, once. Shared by the first attempt and each
 *  regeneration in `buildAgent`'s bounded retry loop. */
async function draftAndValidate(
  need: string,
  deps: BuilderDeps,
  retryFeedback?: ValidationIssue[],
): Promise<{ proposal: AgentProposal; issues: ValidationIssue[] }> {
  const draft = await generateProposal(need, deps.model, retryFeedback);
  const proposal: AgentProposal = {
    ...draft,
    suggestedServers: await suggestServers(need, draft, deps.model),
  };
  const issues = validateProposal(
    proposal,
    deps.existingNames(),
    deps.packNames(),
  );
  return { proposal, issues };
}

/** generate → suggest → validate → consent → write. Consent is mandatory; on
 *  decline or invalid, nothing is written. A structural-validation failure
 *  gets ONE bounded same-run regeneration (feeding back what failed) before
 *  it is reported invalid — never a consent bypass, never same-run
 *  activation, just a second shot at passing validation (Task 24). */
export function buildAgent(
  need: string,
  deps: BuilderDeps,
): Promise<BuildResult> {
  return withAgentBuildSpan(need, async (rec) => {
    let { proposal, issues } = await draftAndValidate(need, deps);
    rec.event('generated', { name: proposal.name });
    rec.event('suggested', { count: proposal.suggestedServers.length });
    rec.event('validated', { ok: issues.length === 0, issues: issues.length });

    for (
      let attempt = 1;
      issues.length > 0 && attempt <= MAX_REGENERATIONS;
      attempt++
    ) {
      rec.event('retrying', { attempt, issues: issues.length });
      ({ proposal, issues } = await draftAndValidate(need, deps, issues));
      rec.event('generated', { name: proposal.name, attempt });
      rec.event('suggested', { count: proposal.suggestedServers.length });
      rec.event('validated', {
        ok: issues.length === 0,
        issues: issues.length,
        attempt,
      });
    }

    if (issues.length > 0) {
      rec.outcome('invalid');
      return { kind: 'invalid', issues };
    }

    const granted = await deps.confirm(renderProposal(proposal));
    rec.event('consent', { granted });
    if (!granted) {
      rec.outcome('declined', proposal.name);
      return { kind: 'declined' };
    }

    const files = writeAgent(proposal, deps.paths);
    rec.event('written', { files: files.length });
    rec.outcome('written', proposal.name, proposal.suggestedServers.length);
    deps.log?.(
      `Created agent "${proposal.name}" (${files.length} file(s)). It is live on the next run.`,
    );
    return { kind: 'written', proposal, files };
  });
}

/** Human-readable consent card for a brand-new tool-code proposal. */
export function renderToolProposal(p: ToolProposal): string {
  return [
    `Proposed tool: ${p.name}`,
    `  ${p.description}`,
    `Why: ${p.rationale}`,
    `File that will be written (for review — NOT activated): tool-proposals/${p.name}.proposal.ts`,
  ].join('\n');
}

/** generate → validate → consent → write, for a brand-new tool module (Task
 *  24 — discharges Slice-17's "no tool-code generation" deferral). Same
 *  bounded same-run retry as `buildAgent`, same mandatory consent gate. The
 *  written file is a PROPOSAL only: writeToolProposal never touches any
 *  registry, index, or MCP config, so nothing in this process can import or
 *  execute it — activation is a separate, later, human-driven step. */
export function buildTool(
  need: string,
  deps: ToolBuilderDeps,
): Promise<ToolBuildResult> {
  return withAgentBuildSpan(need, async (rec) => {
    let draft = await generateToolProposal(need, deps.model);
    let issues = validateToolProposal(draft, deps.existingModuleNames());
    rec.event('tool_generated', { name: draft.name });
    rec.event('tool_validated', {
      ok: issues.length === 0,
      issues: issues.length,
    });

    for (
      let attempt = 1;
      issues.length > 0 && attempt <= MAX_REGENERATIONS;
      attempt++
    ) {
      rec.event('tool_retrying', { attempt, issues: issues.length });
      draft = await generateToolProposal(need, deps.model, issues);
      issues = validateToolProposal(draft, deps.existingModuleNames());
      rec.event('tool_generated', { name: draft.name, attempt });
      rec.event('tool_validated', {
        ok: issues.length === 0,
        issues: issues.length,
        attempt,
      });
    }

    if (issues.length > 0) {
      rec.outcome('invalid');
      return { kind: 'invalid', issues };
    }

    const granted = await deps.confirm(renderToolProposal(draft));
    rec.event('consent', { granted });
    if (!granted) {
      rec.outcome('declined', draft.name);
      return { kind: 'declined' };
    }

    const file = writeToolProposal(draft, deps.proposalsDir);
    rec.event('tool_written');
    rec.outcome('written', draft.name);
    deps.log?.(
      `Wrote tool proposal "${draft.name}" to ${file} for review. It is NOT active — nothing in this run imports or wires it into any agent's toolset.`,
    );
    return { kind: 'written', proposal: draft, file };
  });
}
