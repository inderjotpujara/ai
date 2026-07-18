import { type KeyboardEvent, useRef, useState } from 'react';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { AgentWizard } from './agent-wizard.tsx';
import { CrewWizard } from './crew-wizard.tsx';

type Mode = 'agent' | 'crew';

const TABS: { id: Mode; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'crew', label: 'Crew / Workflow' },
];

/** Builders area: an Agent/Crew mode toggle over the two guided wizards
 *  (D11 "a single /builders with an in-page mode switch" — the plan-time
 *  call the spec left open, resolved here in favor of one route). Phase 8
 *  D2 adds the real keyboard tab-widget pattern via the SAME `nextTabIndex`
 *  helper `LibraryArea` uses (Task 6) — no second implementation. */
export function BuildersArea() {
  const [mode, setMode] = useState<Mode>('agent');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) setMode(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <div
        role="tablist"
        aria-label="Builder mode"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`builders-mode-${t.id}`}
            aria-selected={mode === t.id}
            aria-controls={`builders-panel-${t.id}`}
            tabIndex={mode === t.id ? 0 : -1}
            data-testid={`builders-mode-${t.id}`}
            onClick={() => setMode(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${mode === t.id ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]' : 'text-[var(--color-muted)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {mode === 'agent' ? (
          <div
            role="tabpanel"
            id="builders-panel-agent"
            aria-labelledby="builders-mode-agent"
            data-testid="builders-panel-agent"
          >
            <AgentWizard />
          </div>
        ) : (
          <div
            role="tabpanel"
            id="builders-panel-crew"
            aria-labelledby="builders-mode-crew"
            data-testid="builders-panel-crew"
          >
            <CrewWizard />
          </div>
        )}
      </div>
    </section>
  );
}
