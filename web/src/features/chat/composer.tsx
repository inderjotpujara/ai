import type { ClipboardEvent, DragEvent } from 'react';
import { useState } from 'react';
import { PromptInput } from '../../shared/ai-elements/prompt-input.tsx';
import { MicButton } from '../voice/mic-button.tsx';
import { uploadImage } from './attachments.ts';

/** The ONLY image types the composer will attempt to upload (mirrors the
 *  server's `/api/upload` allowlist — a client-side check is UX only, the
 *  server enforces the real gate). */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

type Attachment = { uploadId: string; name: string };

type Props = {
  onSend: (text: string, uploadIds: string[]) => void;
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
 *
 * Task 16: drag-drop and paste-image attach via a CONFINED upload
 * (media-by-reference) — dropped/pasted image files are POSTed to
 * `/api/upload` immediately, and only the server-minted `uploadId`s (never
 * a raw filesystem path) are threaded into the next `onSend` call.
 */
export function Composer({
  onSend,
  disabled = false,
  initialValue = '',
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  async function addImageFile(file: File): Promise<void> {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return;
    try {
      const uploadId = await uploadImage(file);
      setAttachments((prev) => [...prev, { uploadId, name: file.name }]);
    } catch {
      // Upload failure degrades to "no attachment" — the user can retry the
      // drop/paste. No raw filesystem-path fallback over HTTP (D17).
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    for (const file of Array.from(event.dataTransfer.files)) {
      void addImageFile(file);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    for (const file of Array.from(event.clipboardData.files)) {
      void addImageFile(file);
    }
  }

  function removeAttachment(uploadId: string) {
    setAttachments((prev) => prev.filter((a) => a.uploadId !== uploadId));
  }

  function handleSubmit() {
    const text = value.trim();
    if (text === '') return;
    onSend(
      text,
      attachments.map((a) => a.uploadId),
    );
    setValue('');
    setAttachments([]);
  }

  function handleVoiceFinal(text: string) {
    setValue((v) => (v ? `${v} ${text}` : text));
  }

  return (
    <section
      data-testid="composer-dropzone"
      aria-label="Message composer (drop or paste an image to attach it)"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2">
          {attachments.map((a) => (
            <li
              key={a.uploadId}
              className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-fg)]"
            >
              <span>{a.name}</span>
              <button
                type="button"
                aria-label={`remove ${a.name}`}
                onClick={() => removeAttachment(a.uploadId)}
                className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 px-3 pt-2">
        <MicButton onFinal={handleVoiceFinal} />
      </div>
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        disabled={disabled}
        placeholder="Message the agent…"
      />
    </section>
  );
}
