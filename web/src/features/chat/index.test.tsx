import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

type MockStatus = 'ready' | 'streaming' | 'submitted' | 'error';
type MockPart = { type: string; text?: string };
type MockMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: MockPart[];
};

const sendMessage = vi.fn();
let mockStatus: MockStatus = 'ready';
let mockMessages: MockMessage[] = [];

// The real `useChat` speaks the v6 UI-message-stream SSE wire format, which
// is brittle to fake over `fetch`. Mock the hook itself and drive its return
// shape directly — this proves our rendering + submit wiring against the
// documented v6 contract without re-implementing the wire protocol.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage,
    status: mockStatus,
    stop: vi.fn(),
  }),
}));

describe('ChatArea', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    mockMessages = [];
  });

  it('renders assistant message text via message.parts -> Response', async () => {
    mockMessages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello world' }],
      },
    ];
    renderAt('/');
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('submits typed text via sendMessage and clears the input', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(sendMessage).toHaveBeenCalledWith({ text: 'ping' });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('disables the composer send while status is not ready', async () => {
    mockStatus = 'streaming';
    renderAt('/');
    expect(await screen.findByRole('button', { name: /send/i })).toBeDisabled();
  });
});
