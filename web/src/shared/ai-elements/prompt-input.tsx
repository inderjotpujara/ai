import type { FormEvent, KeyboardEvent } from 'react';
import { Button } from '../ui/button.tsx';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
};

/**
 * Controlled composer. `@ai-sdk/react` v6 `useChat` no longer owns input
 * state, so the parent drives value/onChange. Enter submits; Shift+Enter
 * inserts a newline.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
}: Props) {
  function submit() {
    if (disabled || value.trim() === '') return;
    onSubmit();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
      />
      <Button type="submit" variant="accent" disabled={disabled}>
        Send
      </Button>
    </form>
  );
}
