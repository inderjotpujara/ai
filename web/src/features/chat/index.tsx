import { useChat } from '@ai-sdk/react';
import type { FeedbackRating } from '@contracts';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useState } from 'react';
import { z } from 'zod';
import { apiFetch, sessionToken } from '../../shared/contract/client.ts';
import { createSseTransport } from '../../shared/transport/sse-adapter.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { LiveRail } from '../agents/live-rail.tsx';
import { useStatusEvents } from '../agents/use-status-events.ts';
import { Composer } from './composer.tsx';
import { ConfirmPrompt } from './confirm-prompt.tsx';
import { MessageList } from './message-list.tsx';

/** Join a message's text parts into the single string clipboard/resend need. */
function joinedText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** A user message being edited: its index (truncation point) + prefill text. */
type EditDraft = { index: number; text: string };

export function ChatArea() {
  const { view, handleData, pendingConfirm, runId, clearConfirm } =
    useStatusEvents();
  const { messages, sendMessage, status, stop, regenerate, setMessages } =
    useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
      }),
      onData: handleData,
    });
  const [editDraft, setEditDraft] = useState<EditDraft | undefined>(undefined);

  const isBusy = status === 'streaming' || status === 'submitted';

  function handleSend(text: string, uploadIds: string[]) {
    if (editDraft) {
      // Edit+resend: drop the edited message and everything after it, then
      // resend the edited text as a fresh turn.
      setMessages((msgs) => msgs.slice(0, editDraft.index));
      setEditDraft(undefined);
    }
    // Media-by-reference (Task 16): only thread a `body` override when
    // there's actually an attachment — keeps the plain-text send path
    // byte-for-byte the same call AI SDK's `useChat().sendMessage` sees.
    if (uploadIds.length > 0) {
      sendMessage({ text }, { body: { uploadIds } });
    } else {
      sendMessage({ text });
    }
  }

  function handleCopy(message: UIMessage) {
    navigator.clipboard.writeText(joinedText(message));
  }

  function handleEdit(message: UIMessage) {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index === -1) return;
    setEditDraft({ index, text: joinedText(message) });
  }

  async function handleFeedback(messageId: string, rating: FeedbackRating) {
    await apiFetch('/feedback', {
      method: 'POST',
      body: { messageId, rating },
      schema: z.object({ ok: z.boolean() }),
    });
  }

  async function handleConfirmAnswer(value: boolean) {
    if (!pendingConfirm) return;
    // A Confirm without a prior RunStart has no run to answer to; don't POST
    // to `/api/runs//respond`. Just clear it locally — the prompt is simply
    // left unanswered (no consumer awaits it this phase; the consent channel is
    // a dormant seam, so there is nothing to decline server-side).
    if (!runId) {
      clearConfirm();
      return;
    }
    await createSseTransport().respond(runId, {
      promptId: pendingConfirm.promptId,
      value,
    });
    clearConfirm();
  }

  return (
    <RegionErrorBoundary region="Chat">
      <section data-testid="area-chat" className="flex h-full flex-col">
        <LiveRail view={view} />
        <MessageList
          messages={messages}
          onCopy={handleCopy}
          onRegenerate={(messageId) => regenerate({ messageId })}
          onEdit={handleEdit}
          onFeedback={handleFeedback}
        />
        {pendingConfirm && (
          <ConfirmPrompt ask={pendingConfirm} onAnswer={handleConfirmAnswer} />
        )}
        {isBusy && (
          <div className="flex justify-center border-t border-[var(--color-border)] p-2">
            <Button onClick={() => stop()}>Stop</Button>
          </div>
        )}
        <Composer
          key={editDraft ? editDraft.index : 'compose'}
          initialValue={editDraft?.text ?? ''}
          onSend={handleSend}
          disabled={status !== 'ready'}
        />
      </section>
    </RegionErrorBoundary>
  );
}
