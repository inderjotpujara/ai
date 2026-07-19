### Task 6: Library tabs — real keyboard pattern + shared `nextTabIndex` helper (D2)

**Files:**
- Create: `web/src/shared/ui/tab-list.ts`
- Create: `web/src/shared/ui/tab-list.test.ts`
- Modify: `web/src/features/library/index.tsx` (full new content shown below)
- Modify: `web/src/features/library/index.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new for the helper (pure function).
- Produces: `export function nextTabIndex(key: string, activeIndex: number, count: number): number | undefined` — returns the new roving index for `ArrowLeft`/`ArrowRight` (wrapping)/`Home`/`End`, or `undefined` for any other key (not handled). Consumed by `LibraryArea` here and by `BuildersArea` (Task 7). `LibraryArea`'s tabs gain `role="tabpanel"`/`aria-controls`/`id` linkage and arrow-key roving `tabIndex` — no change to its own public interface (still `export function LibraryArea()`).

- [ ] **Step 1: Write the failing tests**

Create `web/src/shared/ui/tab-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tab-list.ts';

describe('nextTabIndex (D2 — shared roving-tabindex helper)', () => {
  it('ArrowRight moves to the next index and wraps past the last', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
  });

  it('ArrowLeft moves to the previous index and wraps before the first', () => {
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Home/End jump to the first/last index', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('any other key returns undefined (not handled by the tab widget)', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeUndefined();
    expect(nextTabIndex('a', 0, 3)).toBeUndefined();
  });
});
```

Append to `web/src/features/library/index.test.tsx` (inside the existing `describe('LibraryArea', ...)`):

```tsx
it('moves focus with ArrowRight/ArrowLeft (roving tabindex), wrapping at the ends (D2)', async () => {
  renderAt('/library');
  const models = await screen.findByTestId('library-tab-models');
  const memory = screen.getByTestId('library-tab-memory');
  const mcp = screen.getByTestId('library-tab-mcp');

  expect(models).toHaveAttribute('tabIndex', '0');
  expect(memory).toHaveAttribute('tabIndex', '-1');

  models.focus();
  fireEvent.keyDown(models, { key: 'ArrowRight' });
  expect(memory).toHaveFocus();
  expect(screen.getByTestId('library-panel-memory')).toBeInTheDocument();

  fireEvent.keyDown(memory, { key: 'ArrowRight' });
  expect(mcp).toHaveFocus();

  fireEvent.keyDown(mcp, { key: 'ArrowRight' });
  expect(models).toHaveFocus(); // wraps past the last tab
});

it('links each tab to its panel via aria-controls/id/role=tabpanel (D2)', async () => {
  renderAt('/library');
  const modelsTab = await screen.findByTestId('library-tab-models');
  expect(modelsTab).toHaveAttribute('aria-controls', 'library-panel-models');
  expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
    'role',
    'tabpanel',
  );
  expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
    'aria-labelledby',
    'library-tab-models',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- shared/ui/tab-list.test.ts features/library/index.test.tsx`
Expected: FAIL — `tab-list.ts` doesn't exist; `LibraryArea`'s tabs have no `tabIndex`/`aria-controls`/`role="tabpanel"` yet.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/shared/ui/tab-list.ts`:

```ts
/**
 * Pure roving-tabindex helper (D2), shared between `LibraryArea` and
 * `BuildersArea` rather than duplicated. Given the pressed key, the
 * currently-active tab index, and the tab count, returns the new active
 * index — or `undefined` if the key isn't part of the tab widget pattern
 * (ArrowLeft/ArrowRight roving, Home/End jump-to-ends). Callers own moving
 * DOM focus to the returned index (this module has no DOM dependency).
 */
export function nextTabIndex(
  key: string,
  activeIndex: number,
  count: number,
): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (activeIndex + 1) % count;
    case 'ArrowLeft':
      return (activeIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
```

Replace the full contents of `web/src/features/library/index.tsx`:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- shared/ui/tab-list.test.ts features/library/index.test.tsx`
Expected: PASS (4 pre-existing `tab-list`/`nextTabIndex` tests + the pre-existing `LibraryArea` test + the 2 new ones).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/ui/tab-list.ts web/src/shared/ui/tab-list.test.ts web/src/features/library/index.tsx web/src/features/library/index.test.tsx
git commit -m "feat(a11y): Library tabs get real keyboard roving + tabpanel linkage, via a shared helper (D2)"
```

---

