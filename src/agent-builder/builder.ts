import { withAgentBuildSpan } from '../telemetry/spans.ts';
import { generateProposal } from './generate.ts';
import { suggestServers } from './suggest-tools.ts';
import type { AgentProposal, BuilderDeps, BuildResult } from './types.ts';
import { validateProposal } from './validate.ts';
import { writeAgent } from './write.ts';

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

/** generate → suggest → validate → consent → write. Consent is mandatory; on
 *  decline or invalid, nothing is written. */
export function buildAgent(
  need: string,
  deps: BuilderDeps,
): Promise<BuildResult> {
  return withAgentBuildSpan(need, async (rec) => {
    const draft = await generateProposal(need, deps.model);
    rec.event('generated', { name: draft.name });
    const proposal: AgentProposal = {
      ...draft,
      suggestedServers: await suggestServers(need, draft, deps.model),
    };
    rec.event('suggested', { count: proposal.suggestedServers.length });

    const issues = validateProposal(
      proposal,
      deps.existingNames(),
      deps.packNames(),
    );
    rec.event('validated', { ok: issues.length === 0, issues: issues.length });
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
