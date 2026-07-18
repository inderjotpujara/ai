import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptInput } from './prompt-input.tsx';
import { Response } from './response.tsx';

describe('ai-elements', () => {
  it('renders streaming markdown via <Response>', () => {
    render(<Response>{'# Hello\n\nsome **bold** text'}</Response>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('submits the composed prompt from <PromptInput>', async () => {
    const onSubmit = vi.fn();
    render(
      <PromptInput
        value="ship it"
        onChange={() => {}}
        onSubmit={onSubmit}
        placeholder="Ask…"
      />,
    );
    screen.getByRole('button', { name: /send/i }).click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('the composer textarea no longer opts out of the browser focus ring (D1)', () => {
    render(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole('textbox').className).not.toContain('outline-none');
  });

  it('associates a real (visually-hidden) label with the composer textarea (D1)', () => {
    render(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByLabelText(/message/i)).toBe(screen.getByRole('textbox'));
  });
});
