import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Waveform } from './waveform.tsx';

describe('Waveform', () => {
  it('renders a bar scaled to the given level', () => {
    render(<Waveform level={0.5} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });

  it('clamps a level above 1 to 100%', () => {
    render(<Waveform level={2} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('clamps a negative level to 0%', () => {
    render(<Waveform level={-1} />);
    const bar = screen.getByTestId('voice-waveform')
      .firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
