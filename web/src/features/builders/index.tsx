import { useState } from 'react';
import { AgentWizard } from './agent-wizard.tsx';
import { CrewWizard } from './crew-wizard.tsx';

type Mode = 'agent' | 'crew';

/** Builders area: an Agent/Crew mode toggle over the two guided wizards
 *  (D11 "a single /builders with an in-page mode switch" — the plan-time
 *  call the spec left open, resolved here in favor of one route). */
export function BuildersArea() {
  const [mode, setMode] = useState<Mode>('agent');

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <div
        role="tablist"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'agent'}
          data-testid="builders-mode-agent"
          onClick={() => setMode('agent')}
          className={`px-3 py-2 font-mono text-sm ${mode === 'agent' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
        >
          Agent
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'crew'}
          data-testid="builders-mode-crew"
          onClick={() => setMode('crew')}
          className={`px-3 py-2 font-mono text-sm ${mode === 'crew' ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
        >
          Crew / Workflow
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {mode === 'agent' ? <AgentWizard /> : <CrewWizard />}
      </div>
    </section>
  );
}
