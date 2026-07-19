import { useNavigate, useSearch } from '@tanstack/react-router';
import { type KeyboardEvent, useRef } from 'react';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { nextTabIndex } from '../../shared/ui/tab-list.ts';
import { DevicesTab } from './devices-tab.tsx';
import { JobsTab } from './jobs-tab.tsx';
import { OverviewTab } from './overview-tab.tsx';

/** The four Ops tabs. `enum` per this repo's enum-over-union convention. */
export enum OpsTab {
  Overview = 'overview',
  Jobs = 'jobs',
  Triggers = 'triggers',
  Devices = 'devices',
}

const TABS: { id: OpsTab; label: string }[] = [
  { id: OpsTab.Overview, label: 'Overview' },
  { id: OpsTab.Jobs, label: 'Jobs' },
  { id: OpsTab.Triggers, label: 'Triggers' },
  { id: OpsTab.Devices, label: 'Devices & Access' },
];

/** The Ops console shell (Slice 25b): one section, four roving-tabindex
 *  tabs. The active tab is the `?tab=` search param (validated by
 *  `opsRoute` in `router.tsx`) so it is deep-linkable and ⌘K can target it.
 *  Each panel is its own `RegionErrorBoundary` region so one failing card
 *  never blanks the whole console. Panels start as stubs and are replaced
 *  tab-by-tab in later increments — mirrors `LibraryArea`'s tab shell, but
 *  reads/writes the active tab via the router search param (`useSearch`/
 *  `useNavigate`, matching `run-detail.tsx`'s `RunDetailSearch` pattern)
 *  instead of local `useState`. */
export function OpsArea() {
  const { tab } = useSearch({ from: '/ops' });
  const navigate = useNavigate();
  const active = tab ?? OpsTab.Overview;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(next: OpsTab) {
    void navigate({ to: '/ops', search: { tab: next } });
  }

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const next = nextTabIndex(event.key, index, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (nextTab) select(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <section data-testid="area-ops" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Ops</h1>
      <div
        role="tablist"
        aria-label="Ops sections"
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
            id={`ops-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`ops-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            data-testid={`ops-tab-${t.id}`}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`px-3 py-2 font-mono text-sm ${
              active === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex-1 overflow-auto">
        {TABS.map(
          (t) =>
            active === t.id && (
              <div
                key={t.id}
                role="tabpanel"
                id={`ops-panel-${t.id}`}
                aria-labelledby={`ops-tab-${t.id}`}
                data-testid={`ops-panel-${t.id}`}
              >
                <RegionErrorBoundary region={`Ops: ${t.label}`}>
                  {t.id === OpsTab.Overview && <OverviewTab />}
                  {t.id === OpsTab.Jobs && <JobsTab />}
                  {t.id === OpsTab.Devices && <DevicesTab />}
                  {t.id === OpsTab.Triggers && (
                    // Replaced with the real panel content in a later increment.
                    <p className="text-sm text-[var(--color-muted)]">
                      {t.label} — coming in a later increment.
                    </p>
                  )}
                </RegionErrorBoundary>
              </div>
            ),
        )}
      </div>
    </section>
  );
}
