import { useChat } from '@ai-sdk/react';
import type { FeedbackRating } from '@contracts';
import { SessionDtoSchema } from '@contracts';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useState } from 'react';
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

/** Persists the active chat's client-minted session id across reloads (Slice
 *  30b Phase 6, D2): minted once via `crypto.randomUUID()` on the first send
 *  of a new chat, then reused for every later turn in that chat; on a fresh
 *  mount, a stored id triggers a rehydrate fetch instead of a fresh mint. */
const SESSION_STORAGE_KEY = 'agent.activeSessionId';

export function ChatArea() {
  const { view, handleData, pendingConfirm, runId, clearConfirm } =
    useStatusEvents();
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
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

  // Rehydrate a previously-active session on mount (D2): a stored id both
  // becomes the active sessionId (so the next send threads the SAME id, not
  // a fresh mint) and triggers a one-shot transcript fetch. A stale/deleted
  // id (404, or any other fetch/parse failure) clears the stored id rather
  // than repeatedly failing on every later send.
  // One-time mount effect (rehydrate) — not a live sync on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;
    setSessionId(stored);
    apiFetch(`/sessions/${stored}`, { schema: SessionDtoSchema })
      .then((session) => {
        setMessages(
          session.messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            parts: [{ type: 'text' as const, text: m.text }],
          })),
        );
      })
      .catch(() => {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setSessionId(undefined);
      });
  }, []);

  function handleSend(text: string, uploadIds: string[]) {
    if (editDraft) {
      // Edit+resend: drop the edited message and everything after it, then
      // resend the edited text as a fresh turn.
      setMessages((msgs) => msgs.slice(0, editDraft.index));
      setEditDraft(undefined);
    }
    // Mint a session id on the FIRST send of a brand-new chat (D2); once
    // minted (or rehydrated above) it's reused for every later turn.
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      activeSessionId = crypto.randomUUID();
      setSessionId(activeSessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
    }
    const body: { sessionId: string; uploadIds?: string[] } = {
      sessionId: activeSessionId,
    };
    if (uploadIds.length > 0) body.uploadIds = uploadIds;
    sendMessage({ text }, { body });
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
