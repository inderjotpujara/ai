import { useState } from 'react';
import { PromptInput } from '../../shared/ai-elements/prompt-input.tsx';

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
  /**
   * Prefills the input once on mount (edit+resend, Task 15): the parent
   * remounts `<Composer>` with a fresh `key` + `initialValue` set to the
   * message being edited, so this only seeds the initial render.
   */
  initialValue?: string;
};

/**
 * Chat composer. Holds its own input state (v6 `useChat` no longer owns
 * input) and clears it once the message is handed off to the parent.
 */
export function Composer({
  onSend,
  disabled = false,
  initialValue = '',
}: Props) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit() {
    const text = value.trim();
    if (text === '') return;
    onSend(text);
    setValue('');
  }

  return (
    <PromptInput
      value={value}
      onChange={setValue}
      onSubmit={handleSubmit}
      disabled={disabled}
      placeholder="Message the agent…"
    />
  );
}
