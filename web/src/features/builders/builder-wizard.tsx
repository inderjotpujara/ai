import type { BuilderKind } from '@contracts';
import { AgentProposalDtoSchema, BuildResultDtoSchema } from '@contracts';
import { useState } from 'react';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { ConfirmPrompt } from '../chat/confirm-prompt.tsx';
import { agentProposalGraph } from './proposal-graph.ts';
import { useBuildEvents } from './use-build-events.ts';

/**
 * The guided-build wizard body, shared by `AgentWizard`/`CrewWizard` (D11 — a
 * single reusable body over the ~identical need-textarea → narration →
 * confirm → result flow, parameterized only by `kind`; the crews/workflows
 * list precedent applies the OPPOSITE call at a MUCH smaller scale, so
 * duplicating a wizard this size would be the wrong trade here).
 */
export function BuilderWizard({
  kind,
  title,
}: {
  kind: BuilderKind;
  title: string;
}) {
  const { narration, pendingConfirm, result, error, start, respond } =
    useBuildEvents();
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      // `start()` already catches internally and surfaces failures onto
      // `error` (see `use-build-events.ts`), but the call is still wrapped
      // here so a stream failure never becomes an unhandled rejection at
      // this call site either (finding #2).
      await start({ kind, need });
    } catch {
      // no-op: `error` above already reflects the failure.
    } finally {
      setBusy(false);
    }
  }

  // The terminal `result` is kept `unknown` on the wire (`use-build-events.ts`)
  // — validate it against `BuildResultDtoSchema` before rendering anything
  // derived from it (Task-14 review finding: a hand-rolled duck-type guard
  // let a crew/workflow `written` result's `.proposal` slip through, since
  // `BuildResultDTO.proposal` is an UNdiscriminated union of Agent/Crew/
  // Workflow proposal shapes — src/contracts/dto.ts). An invalid/unparseable
  // result renders nothing rather than a raw dump of untrusted shape.
  const parsedResult = BuildResultDtoSchema.safeParse(result);
  const dto = parsedResult.success ? parsedResult.data : undefined;
  // Only an actual agent-shaped proposal (`suggestedServers`/`modelReq`/etc.)
  // may feed `agentProposalGraph`, which assumes those fields — a crew/
  // workflow proposal fails this parse and falls through to the generic
  // result card below instead.
  const agentProposal =
    dto?.kind === 'written' && dto.proposal
      ? AgentProposalDtoSchema.safeParse(dto.proposal)
      : undefined;
  const agentProposalDto = agentProposal?.success
    ? agentProposal.data
    : undefined;

  return (
    <RegionErrorBoundary region={title}>
      <div
        data-testid={`builder-wizard-${kind}`}
        className="flex flex-col gap-4"
      >
        <h2 className="font-mono text-base text-[var(--color-fg)]">{title}</h2>
        {error && (
          <p role="alert" className="text-sm text-[var(--color-muted)]">
            {error}
          </p>
        )}
        <textarea
          data-testid="wizard-need"
          placeholder="Describe the capability you need…"
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          className="h-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-sm text-[var(--color-fg)]"
        />
        <div>
          <Button
            data-testid="wizard-submit"
            disabled={busy || need.trim().length === 0}
            onClick={handleSubmit}
          >
            Build
          </Button>
        </div>
        <ul className="flex flex-col gap-1 font-mono text-sm text-[var(--color-muted)]">
          {narration.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only narration log for one in-flight build
            <li key={i}>{line}</li>
          ))}
        </ul>
        {pendingConfirm && (
          <ConfirmPrompt ask={pendingConfirm} onAnswer={respond} />
        )}
        {agentProposalDto && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-fg)]">
              Created "{dto?.name}".
            </p>
            <DagView model={agentProposalGraph(agentProposalDto)} />
          </div>
        )}
        {dto !== undefined && !agentProposalDto && (
          <pre
            data-testid="wizard-result"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
          >
            {JSON.stringify(dto, null, 2)}
          </pre>
        )}
      </div>
    </RegionErrorBoundary>
  );
}
