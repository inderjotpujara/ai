export function SessionsSidebar() {
  return (
    <aside
      data-testid="sessions-sidebar"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
      <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Sessions
      </h2>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        History arrives in Phase 6.
      </p>
    </aside>
  );
}
