import { FeedbackRating } from '@contracts';
import type { UIMessage } from 'ai';

type Props = {
  message: UIMessage;
  isAssistant: boolean;
  onCopy: (message: UIMessage) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (message: UIMessage) => void;
  onFeedback?: (messageId: string, rating: FeedbackRating) => void;
};

const actionButtonClass =
  'rounded px-1.5 py-0.5 font-mono text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]';

/**
 * Per-message action row (Task 15): copy always; regenerate + thumbs on
 * assistant messages; edit on user messages. Actual side effects (clipboard,
 * `regenerate()`, feedback POST, truncate+resend) live in the caller —
 * this component only renders the affordances and forwards clicks.
 */
export function MessageActions({
  message,
  isAssistant,
  onCopy,
  onRegenerate,
  onEdit,
  onFeedback,
}: Props) {
  return (
    <div className="mt-1 flex gap-1">
      <button
        type="button"
        className={actionButtonClass}
        aria-label="Copy message"
        onClick={() => onCopy(message)}
      >
        Copy
      </button>
      {isAssistant && (
        <>
          <button
            type="button"
            className={actionButtonClass}
            aria-label="Regenerate response"
            onClick={() => onRegenerate?.(message.id)}
          >
            Regenerate
          </button>
          <button
            type="button"
            className={actionButtonClass}
            aria-label="Good response"
            onClick={() => onFeedback?.(message.id, FeedbackRating.Up)}
          >
            👍
          </button>
          <button
            type="button"
            className={actionButtonClass}
            aria-label="Bad response"
            onClick={() => onFeedback?.(message.id, FeedbackRating.Down)}
          >
            👎
          </button>
        </>
      )}
      {!isAssistant && (
        <button
          type="button"
          className={actionButtonClass}
          aria-label="Edit message"
          onClick={() => onEdit?.(message)}
        >
          Edit
        </button>
      )}
    </div>
  );
}
