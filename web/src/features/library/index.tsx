import { useState } from 'react';
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
 *  the crews/workflows list precedent, Phase 4). */
export function LibraryArea() {
  const [tab, setTab] = useState<LibraryTab>('models');

  return (
    <section data-testid="area-library" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Library</h1>
      <div
        role="tablist"
        className="mt-4 flex gap-2 border-b border-[var(--color-border)]"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`library-tab-${t.id}`}
            onClick={() => setTab(t.id)}
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
          <div data-testid="library-panel-models">
            <ModelsTab />
          </div>
        )}
        {tab === 'memory' && (
          <div data-testid="library-panel-memory">
            <MemoryTab />
          </div>
        )}
        {tab === 'mcp' && (
          <div data-testid="library-panel-mcp">
            <McpTab />
          </div>
        )}
      </div>
    </section>
  );
}
