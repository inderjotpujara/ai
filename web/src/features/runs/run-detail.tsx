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
