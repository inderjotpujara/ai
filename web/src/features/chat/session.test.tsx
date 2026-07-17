import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

const SESSION_KEY = 'agent.activeSessionId';

type MockStatus = 'ready' | 'streaming' | 'submitted' | 'error';

const sendMessage = vi.fn();
const setMessages = vi.fn();
let mockStatus: MockStatus = 'ready';

// Same rationale as index.test.tsx/actions.test.tsx: mock the hook itself
// rather than the SSE wire format, and drive its return shape directly.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: mockStatus,
    stop: vi.fn(),
    regenerate: vi.fn(),
    setMessages,
  }),
}));

describe('ChatArea session id (Slice 30b Phase 6, D2)', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    setMessages.mockClear();
    mockStatus = 'ready';
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a v4 UUID sessionId on the first send of a new chat and persists it to localStorage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, opts] = sendMessage.mock.calls[0] as [
      unknown,
      { body: { sessionId: string } },
    ];
    expect(opts.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(localStorage.getItem(SESSION_KEY)).toBe(opts.body.sessionId);
  });

  it('reuses the SAME sessionId across two sends in one mounted chat (does not re-mint)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);

    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const first = (
      sendMessage.mock.calls[0] as [unknown, { body: { sessionId: string } }]
    )[1];
    const second = (
      sendMessage.mock.calls[1] as [unknown, { body: { sessionId: string } }]
    )[1];
    expect(second.body.sessionId).toBe(first.body.sessionId);
  });

  it('rehydrates a stored sessionId on mount: GETs /api/sessions/:id and calls setMessages with the mapped transcript', async () => {
    const storedId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, storedId);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: storedId,
          title: 'Old chat',
          owner: 'local',
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: 'm1', role: 'user', text: 'hello' },
            { id: 'm2', role: 'assistant', text: 'hi there' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');

    await waitFor(() => expect(setMessages).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/sessions/${storedId}`);
    const rehydrated = setMessages.mock.calls[0]?.[0] as {
      id: string;
      role: string;
      parts: { type: string; text: string }[];
    }[];
    expect(rehydrated).toEqual([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hi there' }],
      },
    ]);
  });

  it('does nothing on mount when localStorage has no stored sessionId', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    await screen.findByTestId('area-chat');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('a stale/deleted stored sessionId (404) clears localStorage instead of crashing', async () => {
    localStorage.setItem(SESSION_KEY, 'stale-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );
    renderAt('/');
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
  });
});
