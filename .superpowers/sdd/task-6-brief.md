### Task 6: TanStack Router app shell + feature-area stubs + root render

**Files:**
- Create: `web/src/app/router.tsx`, `web/src/app/app-shell.tsx`, `web/src/main.tsx`, `web/src/features/{chat,crews,workflows,builders,runs,library,settings,sessions}/index.tsx`, `web/src/features/runs/run-detail.tsx`
- Test: `web/src/app/app-shell.test.tsx`

**Interfaces:**
- Consumes: `@tanstack/react-router`, `ThemeProvider`/`useTheme` (Task 3), `RegionErrorBoundary` (Task 4), `Button` (Task 4).
- Produces: `router` (a configured TanStack `Router` with routes `/`, `/crews`, `/workflows`, `/builders`, `/runs`, `/runs/$runId`, `/library`, `/settings`), `AppShell` (root-route layout: top nav across the 7 areas + sessions sidebar placeholder + `<Outlet/>` each wrapped in `RegionErrorBoundary` + theme toggle button). `main.tsx` mounts `<StrictMode><ThemeProvider><RouterProvider/></ThemeProvider></StrictMode>` and imports fonts + tokens.

- [ ] **Step 1: Write the failing test**

`web/src/app/app-shell.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { routeTree } from './router.tsx';
import { ThemeProvider } from '../shared/design/theme.tsx';

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('renders navigation for all 7 areas', async () => {
    renderAt('/');
    for (const label of ['Chat', 'Crews', 'Workflows', 'Builders', 'Runs', 'Library', 'Settings']) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Chat area stub at /', async () => {
    renderAt('/');
    expect(await screen.findByTestId('area-chat')).toBeInTheDocument();
  });

  it('renders the run-detail stub at /runs/:runId', async () => {
    renderAt('/runs/abc');
    expect(await screen.findByTestId('run-detail')).toHaveTextContent('abc');
  });

  it('exposes a theme toggle', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: /theme/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test src/app/app-shell.test.tsx`
Expected: FAIL — cannot resolve `./router.tsx`.

- [ ] **Step 3: Write the area stubs, shell, and router**

Feature stubs — one per area. Example `web/src/features/chat/index.tsx` (repeat the pattern for crews/workflows/builders/runs/library/settings/sessions, changing the name + testid):
```tsx
export function ChatArea() {
  return (
    <section data-testid="area-chat" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Chat</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Streaming chat lands in Phase 2.
      </p>
    </section>
  );
}
```
Create the analogous exports: `CrewsArea` (`area-crews`), `WorkflowsArea` (`area-workflows`), `BuildersArea` (`area-builders`), `RunsArea` (`area-runs`), `LibraryArea` (`area-library`), `SettingsArea` (`area-settings`), and `SessionsSidebar` in `web/src/features/sessions/index.tsx`:
```tsx
export function SessionsSidebar() {
  return (
    <aside
      data-testid="sessions-sidebar"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
      <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Sessions
      </h2>
      <p className="mt-2 text-xs text-[var(--color-muted)]">History arrives in Phase 6.</p>
    </aside>
  );
}
```

`web/src/features/runs/run-detail.tsx`:
```tsx
import { useParams } from '@tanstack/react-router';

export function RunDetail() {
  const { runId } = useParams({ from: '/runs/$runId' });
  return (
    <section data-testid="run-detail" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Run {runId}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Trace view lands in Phase 3.</p>
    </section>
  );
}
```

`web/src/app/app-shell.tsx`:
```tsx
import { Link, Outlet } from '@tanstack/react-router';
import { RegionErrorBoundary } from '../shared/ui/error-boundary.tsx';
import { Button } from '../shared/ui/button.tsx';
import { useTheme } from '../shared/design/theme.tsx';
import { SessionsSidebar } from '../features/sessions/index.tsx';

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Chat' },
  { to: '/crews', label: 'Crews' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/builders', label: 'Builders' },
  { to: '/runs', label: 'Runs' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-2">
        <span className="font-mono text-sm text-[var(--color-accent)]">◇ local-agents</span>
        <nav className="flex gap-3" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="font-mono text-sm text-[var(--color-muted)] [&.active]:text-[var(--color-fg)]"
              activeOptions={{ exact: n.to === '/' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <kbd className="rounded border border-[var(--color-border)] px-1.5 text-xs text-[var(--color-muted)]">
            ⌘K
          </kbd>
          <Button onClick={toggle} aria-label={`theme: ${theme}`}>
            {theme === 'dark' ? '☾' : '☀'}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar />
        <main className="min-w-0 flex-1 overflow-auto">
          <RegionErrorBoundary region="Workspace">
            <Outlet />
          </RegionErrorBoundary>
        </main>
      </div>
    </div>
  );
}
```

`web/src/app/router.tsx`:
```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppShell } from './app-shell.tsx';
import { ChatArea } from '../features/chat/index.tsx';
import { CrewsArea } from '../features/crews/index.tsx';
import { WorkflowsArea } from '../features/workflows/index.tsx';
import { BuildersArea } from '../features/builders/index.tsx';
import { RunsArea } from '../features/runs/index.tsx';
import { RunDetail } from '../features/runs/run-detail.tsx';
import { LibraryArea } from '../features/library/index.tsx';
import { SettingsArea } from '../features/settings/index.tsx';

const rootRoute = createRootRoute({ component: AppShell });

const route = (path: string, component: () => JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

export const routeTree = rootRoute.addChildren([
  route('/', ChatArea),
  route('/crews', CrewsArea),
  route('/workflows', WorkflowsArea),
  route('/builders', BuildersArea),
  route('/runs', RunsArea),
  route('/runs/$runId', RunDetail),
  route('/library', LibraryArea),
  route('/settings', SettingsArea),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './shared/design/tokens.css';
import { ThemeProvider } from './shared/design/theme.tsx';
import { router } from './app/router.tsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root mount');

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
```

_Note: if `tsc` complains about the `JSX.Element` return type in the `route` helper, import `type { JSX } from 'react'` or type the components as `React.ComponentType`. Verify against `@tanstack/react-router`'s installed types._

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test src/app/app-shell.test.tsx`
Expected: PASS (4 tests). Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ web/src/features/ web/src/main.tsx
git commit -m "feat(web): TanStack Router app shell + 7 nav-area stubs + root render"
```

---

