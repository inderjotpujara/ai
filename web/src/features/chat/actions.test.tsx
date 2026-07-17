import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

type MockStatus = 'ready' | 'streaming' | 'submitted' | 'error';
type MockPart = { type: string; text?: string };
type MockMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: MockPart[];
};

const sendMessage = vi.fn();
const stop = vi.fn();
const regenerate = vi.fn();
const setMessages = vi.fn();
let mockStatus: MockStatus = 'ready';
let mockMessages: MockMessage[] = [];

// Same rationale as index.test.tsx: mock the hook itself (real useChat speaks
// the v6 SSE wire format, brittle to fake over fetch) and drive its return
// shape, now extended with stop/regenerate/setMessages for Task 15.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage,
    status: mockStatus,
    stop,
    regenerate,
    setMessages,
  }),
}));

describe('ChatArea conversation actions', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    stop.mockClear();
    regenerate.mockClear();
    setMessages.mockClear();
    mockStatus = 'ready';
    mockMessages = [];
    localStorage.clear();

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Stop button while streaming and calls stop() on click', async () => {
    mockStatus = 'streaming';
    renderAt('/');
    const stopButton = await screen.findByRole('button', { name: /^stop$/i });
    fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('shows a Stop button while submitted (pre-first-token)', async () => {
    mockStatus = 'submitted';
    renderAt('/');
    expect(
      await screen.findByRole('button', { name: /^stop$/i }),
    ).toBeInTheDocument();
  });

  it('hides the Stop button when ready', async () => {
    renderAt('/');
    await screen.findByTestId('area-chat');
    expect(
      screen.queryByRole('button', { name: /^stop$/i }),
    ).not.toBeInTheDocument();
  });

  it('copy writes the message text to the clipboard', async () => {
    mockMessages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello world' }],
      },
    ];
    renderAt('/');
    const copyButton = await screen.findByRole('button', {
      name: /copy message/i,
    });
    fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello world');
  });

  it('regenerate targets the clicked assistant message by id', async () => {
    mockMessages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first answer' }],
      },
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'follow-up' }],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second answer' }],
      },
    ];
    renderAt('/');
    const regenButtons = await screen.findAllByRole('button', {
      name: /regenerate/i,
    });
    // Click Regenerate on the FIRST assistant message (a1), not the last.
    fireEvent.click(regenButtons[0] as HTMLElement);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith({ messageId: 'a1' });
  });

  it('thumbs-up POSTs /api/feedback with the message id and rating', async () => {
    mockMessages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello world' }],
      },
    ];
    renderAt('/');
    const upButton = await screen.findByRole('button', {
      name: /good response/i,
    });
    fireEvent.click(upButton);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // biome-ignore lint/style/noNonNullAssertion: awaited call is guaranteed present
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/feedback');
    expect(JSON.parse(init.body as string)).toEqual({
      messageId: 'm1',
      rating: 'up',
    });
  });

  it('editing a user message prefills the composer, truncates via setMessages, then resends', async () => {
    mockMessages = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'first question' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first answer' }],
      },
    ];
    renderAt('/');
    const editButton = await screen.findByRole('button', {
      name: /edit message/i,
    });
    fireEvent.click(editButton);

    const textarea = await screen.findByPlaceholderText(/./i);
    expect((textarea as HTMLTextAreaElement).value).toBe('first question');

    fireEvent.change(textarea, { target: { value: 'edited question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(setMessages).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: awaited call is guaranteed present
    const updater = setMessages.mock.calls[0]![0] as (
      msgs: MockMessage[],
    ) => MockMessage[];
    // Truncates to BEFORE the edited user message (index 0) — drops it and
    // everything after, since the edited text is resent as a fresh turn.
    expect(updater(mockMessages)).toEqual([]);
    // Slice 30b Phase 6 (D2): every send threads a body.sessionId, edit+resend included.
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'edited question' },
      { body: { sessionId: expect.any(String) } },
    );
  });
});
