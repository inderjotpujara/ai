import { Link, Outlet } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { RunNotifyEvent } from '../features/notifications/notify-diff.ts';
import { ToastHost, useToast } from '../features/notifications/toast.tsx';
import { useRunNotifications } from '../features/notifications/use-run-notifications.ts';
import { SessionsSidebar } from '../features/sessions/index.tsx';
import { isOsNotifyEnabled } from '../features/settings/index.tsx';
import { useTheme } from '../shared/design/theme.tsx';
import { Button } from '../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../shared/ui/error-boundary.tsx';
import { CommandPalette } from './command-palette.tsx';

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Chat' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/crews', label: 'Crews' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/builders', label: 'Builders' },
  { to: '/runs', label: 'Runs' },
  { to: '/ops', label: 'Ops' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];

/** Public entry: mounts the `ToastHost` provider, then renders the real
 *  shell as a child so `AppShellInner` can call `useToast()` (a component
 *  can't consume a context provider it itself renders). */
export function AppShell() {
  return (
    <ToastHost>
      <AppShellInner />
    </ToastHost>
  );
}

function formatRunNotify(event: RunNotifyEvent): string {
  const seconds = Math.round(event.durationMs / 1000);
  return `${event.kind} run finished (${seconds}s)`;
}

function AppShellInner() {
  const { theme, toggle } = useTheme();
  const { notify } = useToast();

  const onRunNotify = useCallback(
    (event: RunNotifyEvent) => {
      const text = formatRunNotify(event);
      notify(text);
      if (
        isOsNotifyEnabled() &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification('Run finished', { body: text });
      }
    },
    [notify],
  );
  useRunNotifications(onRunNotify);

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
          <Button
            onClick={toggle}
            aria-label={`theme: ${theme}`}
            aria-pressed={theme === 'dark'}
          >
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
