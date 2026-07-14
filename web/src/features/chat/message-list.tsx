import type { UIMessage } from 'ai';
import { Conversation } from '../../shared/ai-elements/conversation.tsx';
import { Message, MessageContent } from '../../shared/ai-elements/message.tsx';
import { Response } from '../../shared/ai-elements/response.tsx';

/** Join a message's text parts into the single string streamdown needs. */
function joinedText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function MessageList({ messages }: { messages: UIMessage[] }) {
  return (
    <Conversation>
      {messages.map((message) => (
        <Message
          key={message.id}
          role={message.role === 'user' ? 'user' : 'assistant'}
        >
          {message.role === 'assistant' ? (
            <Response>{joinedText(message)}</Response>
          ) : (
            <MessageContent>{joinedText(message)}</MessageContent>
          )}
        </Message>
      ))}
    </Conversation>
  );
}
