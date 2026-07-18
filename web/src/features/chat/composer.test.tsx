import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../voice/mic-button.tsx', () => ({
  MicButton: ({ onFinal }: { onFinal: (text: string) => void }) => (
    <button type="button" onClick={() => onFinal('voice transcript')}>
      fixture-mic
    </button>
  ),
}));

import { Composer } from './composer.tsx';

describe('Composer — voice wiring (Slice 30b Phase 7)', () => {
  it('appends a final voice transcript into the value via setValue', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    fireEvent.click(screen.getByText('fixture-mic'));
    const textarea = screen.getByPlaceholderText(/./i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('voice transcript');
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
