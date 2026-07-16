import type { BuilderKind } from '@contracts';
import { useState } from 'react';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmPrompt } from '../chat/confirm-prompt.tsx';
import { agentProposalGraph } from './proposal-graph.ts';
import { useBuildEvents } from './use-build-events.ts';

type WrittenResult = {
  kind: 'written';
  name?: string;
  files?: string[];
  proposal?: Parameters<typeof agentProposalGraph>[0];
};

function isWrittenWithProposal(result: unknown): result is WrittenResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { kind?: unknown }).kind === 'written' &&
    'proposal' in result &&
    (result as { proposal?: unknown }).proposal !== undefined
  );
}

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
  const { narration, pendingConfirm, result, start, respond } =
    useBuildEvents();
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      await start({ kind, need });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`builder-wizard-${kind}`} className="flex flex-col gap-4">
      <h2 className="font-mono text-base text-[var(--color-fg)]">{title}</h2>
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
      {isWrittenWithProposal(result) && result.proposal && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-fg)]">
            Created "{result.name}".
          </p>
          <DagView model={agentProposalGraph(result.proposal)} />
        </div>
      )}
      {result !== undefined && !isWrittenWithProposal(result) && (
        <pre
          data-testid="wizard-result"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
