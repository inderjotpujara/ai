import type { FeedbackRating } from '@contracts';
import type { UIMessage } from 'ai';
import { Conversation } from '../../shared/ai-elements/conversation.tsx';
import { Message, MessageContent } from '../../shared/ai-elements/message.tsx';
import { Response } from '../../shared/ai-elements/response.tsx';
import { MessageActions } from './message-actions.tsx';

/** Join a message's text parts into the single string streamdown needs. */
function joinedText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

type Props = {
  messages: UIMessage[];
  onCopy: (message: UIMessage) => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (message: UIMessage) => void;
  onFeedback: (messageId: string, rating: FeedbackRating) => void;
};

export function MessageList({
  messages,
  onCopy,
  onRegenerate,
  onEdit,
  onFeedback,
}: Props) {
  return (
    <Conversation>
      {messages.map((message) => {
        const isAssistant = message.role === 'assistant';
        return (
          <Message key={message.id} role={isAssistant ? 'assistant' : 'user'}>
            {isAssistant ? (
              <Response>{joinedText(message)}</Response>
            ) : (
              <MessageContent>{joinedText(message)}</MessageContent>
            )}
            <MessageActions
              message={message}
              isAssistant={isAssistant}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
              onFeedback={onFeedback}
            />
          </Message>
        );
      })}
    </Conversation>
  );
}
