import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../voice/mic-button.tsx', () => ({
  MicButton: ({ onFinal }: { onFinal: (text: string) => void }) => (
    <button type="button" onClick={() => onFinal('voice transcript')}>
      fixture-mic
    </button>
  ),
}));

// The composer only mounts its mic-button wrapper when voice input is
// enabled (C2 fix — avoids an empty padded row above the input for the
// default voice-OFF user); most of these tests exercise the ON path, so the
// mock defaults to true, with one test below overriding it to false.
const isVoiceInputEnabledMock = vi.fn(() => true);
vi.mock('../settings/index.tsx', () => ({
  isVoiceInputEnabled: () => isVoiceInputEnabledMock(),
}));

import { Composer } from './composer.tsx';

describe('Composer — voice wiring (Slice 30b Phase 7)', () => {
  beforeEach(() => {
    isVoiceInputEnabledMock.mockReturnValue(true);
  });

  it('appends a final voice transcript into the value via setValue', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    fireEvent.click(screen.getByText('fixture-mic'));
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('voice transcript');
  });

  it('renders no mic-button wrapper when voice input is disabled (C2 — no empty padded row for the default voice-OFF user)', () => {
    isVoiceInputEnabledMock.mockReturnValue(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    expect(screen.queryByText('fixture-mic')).not.toBeInTheDocument();
  });

  it('appends onto EXISTING typed text with a separating space rather than replacing it', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('fixture-mic'));
    expect(textarea.value).toBe('hello voice transcript');
  });

  it('leaves the existing Send/onSend submit path completely untouched', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'typed message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('typed message', []);
    expect(textarea.value).toBe('');
  });
});
