import qwenFast from '../../models/qwen-fast.ts';
import type { Agent } from '../core/agent-def.ts';
import { embedOne } from '../memory/embed-one.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import { withAgentBuildSpan } from '../telemetry/spans.ts';
import { representativeTask } from '../verified-build/dry-run.ts';
import { evalCases } from '../verified-build/eval.ts';
import type { GateDeps } from '../verified-build/gate.ts';
import { verifyAndCommit } from '../verified-build/gate.ts';
import { generateGolden, goldenPathFor } from '../verified-build/golden.ts';
import { selectJudge } from '../verified-build/judge.ts';
import { upsertEntry } from '../verified-build/manifest.ts';
import { reuseDecision } from '../verified-build/reuse.ts';
import {
  signatureFromNeed,
  signatureFromProposal,
  signatureText,
} from '../verified-build/signature.ts';
import {
  ArtifactKind,
  ReuseKind,
  VerifiedLevel,
} from '../verified-build/types.ts';
import { generateProposal } from './generate.ts';
import { generateToolProposal } from './generate-tool.ts';
import { suggestServers } from './suggest-tools.ts';
import type {
  AgentProposal,
  BuilderDeps,
  BuilderVerifyDeps,
  BuildResult,
  ToolBuilderDeps,
  ToolBuildResult,
  ToolProposal,
  ValidationIssue,
} from './types.ts';
import { validateProposal } from './validate.ts';
import { validateToolProposal } from './validate-tool.ts';
import {
  atomicWrite,
  registerAgent,
  writeAgent,
  writeAgentFile,
} from './write.ts';
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

/** Build the in-memory `Agent` a staged proposal would run as, WITHOUT
 *  touching the registry. Mirrors `write.ts`'s `renderAgentFile` model choice
 *  (qwenFast via Ollama) so a dry-run/golden-eval pass is representative of
 *  what gets committed. Tools are intentionally empty: mounting the real,
 *  scoped MCP clients for a not-yet-registered agent is heavier than a
 *  pre-commit smoke check needs — TODO(controller): wire real scoped tools
 *  here once verification can spin up MCP clients for a staged agent. */
function agentFromProposal(p: AgentProposal): Agent {
  return {
    name: p.name,
    description: p.description,
    model: createOllamaModel(qwenFast),
    systemPrompt: p.systemPrompt,
    tools: {},
    modelDecl: qwenFast,
    modelReq: p.modelReq,
  };
}

/** What flows through the gate's `def: unknown` for an agent build: the
 *  proposal (structural validation, commit/registration) and the runnable
 *  `Agent` built from it (dry-run, golden-eval). */
type StagedAgent = { proposal: AgentProposal; agent: Agent };

/** Build the `GateDeps` for one agent proposal and run `verifyAndCommit`,
 *  then map its `VerificationResult` onto `BuildResult`. Split out of
 *  `buildAgent` to keep the consent-gated happy path readable. */
async function verifyAndCommitProposal(
  need: string,
  proposal: AgentProposal,
  deps: BuilderDeps,
  verify: BuilderVerifyDeps,
): Promise<BuildResult> {
  const sig = signatureFromProposal(proposal);
  const vector = await embedOne(signatureText(sig), verify.embed);
  let stagedPath: string | undefined;
  let registeredFiles: string[] = [];

  const gateDeps: GateDeps = {
    kind: ArtifactKind.Agent,
    name: proposal.name,
    need,
    signature: sig,
    stage: async (_feedback) => {
      // v1: feedback-driven repair of the PROPOSAL itself isn't implemented
      // yet — a re-stage (after a failed dry-run) just rewrites the SAME
      // proposal, a no-op regeneration acceptable for v1 per spec.
      // TODO(controller): route `_feedback` into a targeted regeneration.
      stagedPath = writeAgentFile(proposal, deps.paths);
      const staged: StagedAgent = {
        proposal,
        agent: agentFromProposal(proposal),
      };
      return { def: staged };
    },
    structural: async (def) => {
      const { proposal: p } = def as StagedAgent;
      return validateProposal(p, deps.existingNames(), deps.packNames()).map(
        (i) => `${i.field}: ${i.problem}`,
      );
    },
    dryRunOnce: async (def) => {
      const { agent } = def as StagedAgent;
      const r = await verify.runAgent(agent, representativeTask(need, sig));
      return {
        ran: 'text' in r,
        output: 'text' in r ? r.text : undefined,
        error: 'error' in r ? r.error : undefined,
        repairs: 0,
      };
    },
    goldenEval: async (def) => {
      const { agent } = def as StagedAgent;
      const judgePick = selectJudge({
        candidates: verify.judgeCandidates,
        generatorFamily: verify.generatorFamily,
      });
      if (judgePick.model === null) return null;
      const golden = await generateGolden(need, sig, deps.model);
      return evalCases(golden.cases, {
        runCase: async (input) => {
          const r = await verify.runAgent(agent, input);
          return 'text' in r ? r.text : `error: ${r.error}`;
        },
        judge: verify.judge,
        judgeModel: judgePick.model,
        belowBar: judgePick.belowBar,
      });
    },
    makeGolden: () => generateGolden(need, sig, deps.model),
    commit: async (def, level, golden, vec) => {
      const { proposal: p } = def as StagedAgent;
      registeredFiles = registerAgent(p, deps.paths);
      const goldenPath = goldenPathFor(verify.dir, p.name);
      upsertEntry(verify.dir, p.name, {
        need,
        signature: signatureFromProposal(p),
        vector: vec,
        verifiedLevel: level,
        goldenPath,
        createdAtMs: Date.now(),
        lastUsedMs: 0,
        useCount: 0,
        lastEvalPass: level === VerifiedLevel.Behaves,
      });
      if (golden) {
        atomicWrite(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
      }
    },
    vector,
    force: verify.force ?? false,
  };

  const result = await verifyAndCommit(gateDeps);
  if (result.kind === 'committed') {
    const files = stagedPath
      ? [stagedPath, ...registeredFiles]
      : registeredFiles;
    deps.log?.(
      `Created agent "${proposal.name}" (${files.length} file(s), verified: ${result.level}). It is live on the next run.`,
    );
    return { kind: 'written', proposal, files, level: result.level };
  }
  if (result.kind === 'reused') {
    return { kind: 'reused', name: result.name, similarity: result.similarity };
  }
  return {
    kind: 'failed-verification',
    stage: result.stage,
    detail: result.detail,
  };
}

/** generate → suggest → validate → consent → write. Consent is mandatory; on
 *  decline or invalid, nothing is written. A structural-validation failure
 *  gets ONE bounded same-run regeneration (feeding back what failed) before
 *  it is reported invalid — never a consent bypass, never same-run
 *  activation, just a second shot at passing validation (Task 24).
 *
 *  When `deps.verify` is present, this becomes reuse-check → generate →
 *  consent → stage → verify → commit: a reuse hit short-circuits before any
 *  generation, and a granted proposal is staged to disk and run through
 *  `verifyAndCommit` (structural / dry-run / golden-eval) BEFORE it is
 *  registered — nothing broken lands in the registry. */
export function buildAgent(
  need: string,
  deps: BuilderDeps,
): Promise<BuildResult> {
  return withAgentBuildSpan(need, async (rec) => {
    if (deps.verify) {
      const need_sig = await signatureFromNeed(need, deps.model);
      const decision = await reuseDecision(need_sig, {
        embed: deps.verify.embed,
        dir: deps.verify.dir,
      });
      rec.event('reuse_checked', {
        kind: decision.kind,
        similarity: decision.similarity,
      });
      if (decision.kind === ReuseKind.Reuse && decision.match) {
        rec.outcome('reused', decision.match);
        return {
          kind: 'reused',
          name: decision.match,
          similarity: decision.similarity,
        };
      }
    }

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

    if (deps.verify) {
      const result = await verifyAndCommitProposal(
        need,
        proposal,
        deps,
        deps.verify,
      );
      rec.event('gate_result', { kind: result.kind });
      rec.outcome(result.kind, proposal.name, proposal.suggestedServers.length);
      return result;
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
