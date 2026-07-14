import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { uploadImage } from './attachments.ts';

type MockStatus = 'ready' | 'streaming' | 'submitted' | 'error';

const sendMessage = vi.fn();
let mockStatus: MockStatus = 'ready';

// Same rationale as index.test.tsx: mock the hook itself rather than the SSE
// wire format, and drive its return shape directly.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: mockStatus,
    stop: vi.fn(),
  }),
}));

function pngFile(name = 'cat.png'): File {
  return new File(['fake-bytes'], name, { type: 'image/png' });
}

describe('uploadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs multipart form data to /api/upload and returns the uploadId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uploadId: 'server-minted-id.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const uploadId = await uploadImage(pngFile());

    expect(uploadId).toBe('server-minted-id.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('rejects when the upload endpoint responds non-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad', { status: 400 })),
    );
    await expect(uploadImage(pngFile())).rejects.toThrow();
  });
});

describe('Composer drag-drop / paste-image attachments', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    mockStatus = 'ready';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ uploadId: 'dropped-abc123.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dropping an image file uploads it and shows an attachment chip', async () => {
    renderAt('/');
    const dropzone = await screen.findByTestId('composer-dropzone');
    const file = pngFile();

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(await screen.findByText('cat.png')).toBeInTheDocument();
  });

  it('pasting an image file uploads it and shows an attachment chip', async () => {
    renderAt('/');
    const dropzone = await screen.findByTestId('composer-dropzone');
    const file = pngFile('pasted.png');

    fireEvent.paste(dropzone, { clipboardData: { files: [file] } });

    expect(await screen.findByText('pasted.png')).toBeInTheDocument();
  });

  it('the next send includes the uploaded id in the sendMessage body, and clears the chip', async () => {
    renderAt('/');
    const dropzone = await screen.findByTestId('composer-dropzone');
    fireEvent.drop(dropzone, { dataTransfer: { files: [pngFile()] } });
    await screen.findByText('cat.png');

    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'look at this' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        { text: 'look at this' },
        { body: { uploadIds: ['dropped-abc123.png'] } },
      ),
    );
    expect(screen.queryByText('cat.png')).not.toBeInTheDocument();
  });

  it('a plain text send with no attachment calls sendMessage with just { text } (regression: no empty body override)', async () => {
    renderAt('/');
    const textarea = await screen.findByPlaceholderText(/./i);
    fireEvent.change(textarea, { target: { value: 'no image here' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ text: 'no image here' }),
    );
  });
});
