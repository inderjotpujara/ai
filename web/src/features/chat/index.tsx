import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { sessionToken } from '../../shared/contract/client.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { LiveRail } from '../agents/live-rail.tsx';
import { useStatusEvents } from '../agents/use-status-events.ts';
import { Composer } from './composer.tsx';
import { MessageList } from './message-list.tsx';

export function ChatArea() {
  const { view, handleData } = useStatusEvents();
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
    }),
    onData: handleData,
  });

  return (
    <RegionErrorBoundary region="Chat">
      <section data-testid="area-chat" className="flex h-full flex-col">
        <LiveRail view={view} />
        <MessageList messages={messages} />
        <Composer
          onSend={(text) => sendMessage({ text })}
          disabled={status !== 'ready'}
        />
      </section>
    </RegionErrorBoundary>
  );
}
