import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { echoBuilderStub } from './echo-stub.ts';

/** Builders area scaffold (Increment 1). The need-textarea + narration-list
 *  shell is real; the stream behind it is the local `echoBuilderStub` until
 *  Increment 2 wires `POST /api/builders/build` + `use-build-events.ts` and
 *  replaces this component's body with the guided wizard. */
export function BuildersArea() {
  const [need, setNeed] = useState('');
  const [narration, setNarration] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setNarration([]);
    setBusy(true);
    try {
      for await (const line of echoBuilderStub(need)) {
        setNarration((prev) => [...prev, line]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="area-builders" className="flex h-full flex-col p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Builders</h1>
      <textarea
        data-testid="builders-need"
        placeholder="Describe the capability you need…"
        value={need}
        onChange={(e) => setNeed(e.target.value)}
        className="mt-4 h-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-sm text-[var(--color-fg)]"
      />
      <div className="mt-2">
        <Button
          data-testid="builders-submit"
          disabled={busy || need.trim().length === 0}
          onClick={handleSubmit}
        >
          Build
        </Button>
      </div>
      <ul className="mt-4 flex flex-col gap-1 font-mono text-sm text-[var(--color-muted)]">
        {narration.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only local narration log, never reordered/removed mid-stream
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
