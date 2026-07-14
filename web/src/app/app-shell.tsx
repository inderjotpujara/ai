import { Link, Outlet } from '@tanstack/react-router';
import { SessionsSidebar } from '../features/sessions/index.tsx';
import { useTheme } from '../shared/design/theme.tsx';
import { Button } from '../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../shared/ui/error-boundary.tsx';
import { CommandPalette } from './command-palette.tsx';

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
        <span className="font-mono text-sm text-[var(--color-accent)]">
          ◇ local-agents
        </span>
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
      <CommandPalette />
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
