import { type KeyboardEvent, useRef, useState } from 'react';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { McpTab } from './mcp-tab.tsx';
import { MemoryTab } from './memory-tab.tsx';
import { ModelsTab } from './models-tab.tsx';

type LibraryTab = 'models' | 'memory' | 'mcp';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory' },
  { id: 'mcp', label: 'MCP' },
];

/** The Library area: one shell, three tabs (Models · Memory · MCP). Models
 *  is the real inventory table + per-row Pull (Task 18); MCP is the real
 *  server list + Add-server form + Test-mount (Task 25, Increment 4); Memory
 *  is the real spaces list + upload-ingest + recall search (Task 29,
 *  Increment 5) — each tab replaced its stub the same way, without touching
 *  this shell (D11: one engine seam per increment). Duplicated a third time
 *  rather than prematurely abstracted into a shared facet component (matches
 *  the crews/workflows list precedent, Phase 4). Phase 8 D2 adds the real
 *  keyboard tab-widget pattern (arrow-key roving tabindex + tabpanel
 *  linkage) via the shared `nextTabIndex` helper, reused verbatim by
 *  `BuildersArea` (Task 7). */
export function LibraryArea() {
  const [tab, setTab] = useState<LibraryTab>('models');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) setTab(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-library" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Library</h1>
      <div
        role="tablist"
        aria-label="Library sections"
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
            id={`library-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`library-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            data-testid={`library-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${
              tab === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {tab === 'models' && (
          <div
            role="tabpanel"
            id="library-panel-models"
            aria-labelledby="library-tab-models"
            data-testid="library-panel-models"
          >
            <ModelsTab />
          </div>
        )}
        {tab === 'memory' && (
          <div
            role="tabpanel"
            id="library-panel-memory"
            aria-labelledby="library-tab-memory"
            data-testid="library-panel-memory"
          >
            <MemoryTab />
          </div>
        )}
        {tab === 'mcp' && (
          <div
            role="tabpanel"
            id="library-panel-mcp"
            aria-labelledby="library-tab-mcp"
            data-testid="library-panel-mcp"
          >
            <McpTab />
          </div>
        )}
      </div>
    </section>
  );
}
