import { useEffect } from 'react';
import { Button } from '../../shared/ui/button.tsx';

export type ConfirmAsk = {
  promptId: string;
  kind: string;
  question: string;
};

type Props = {
  ask: ConfirmAsk;
  onAnswer: (value: boolean) => void;
};

/**
 * Inline human-in-the-loop consent prompt for a `data-confirm` event
 * (Task 15). Approve/Decline answer directly; the ✕ and Escape are both a
 * *dismiss*, which fails safe to `onAnswer(false)` (decline) rather than
 * silently doing nothing.
 */
export function ConfirmPrompt({ ask, onAnswer }: Props) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onAnswer(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onAnswer]);

  return (
    <div
      data-testid="confirm-prompt"
      className="m-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-fg)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase text-[var(--color-muted)]">
            {ask.kind}
          </p>
          <p>{ask.question}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          onClick={() => onAnswer(false)}
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="accent" onClick={() => onAnswer(true)}>
          Approve
        </Button>
        <Button onClick={() => onAnswer(false)}>Decline</Button>
      </div>
    </div>
  );
}
