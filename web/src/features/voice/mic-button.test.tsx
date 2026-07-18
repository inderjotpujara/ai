import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useVoiceInputMock = vi.fn();
vi.mock('./use-voice-input.ts', () => ({
  useVoiceInput: (...args: unknown[]) => useVoiceInputMock(...args),
}));

const isVoiceInputEnabledMock = vi.fn();
const voiceModelTierMock = vi.fn();
vi.mock('../settings/index.tsx', () => ({
  isVoiceInputEnabled: () => isVoiceInputEnabledMock(),
  voiceModelTier: () => voiceModelTierMock(),
}));

import { MicButton } from './mic-button.tsx';

function baseVoice(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    ready: true,
    level: 0,
    interim: '',
    error: undefined,
    startHold: vi.fn(),
    stopHold: vi.fn(),
    toggleTap: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe('MicButton', () => {
  beforeEach(() => {
    isVoiceInputEnabledMock.mockReturnValue(true);
    voiceModelTierMock.mockReturnValue('moonshine-base');
    useVoiceInputMock.mockReset();
  });

  it('renders nothing when voice input is disabled in Settings', () => {
    isVoiceInputEnabledMock.mockReturnValue(false);
    useVoiceInputMock.mockReturnValue(baseVoice());
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.queryByTestId('mic-button')).not.toBeInTheDocument();
  });

  it('shows a disabled loading state while the model is loading', () => {
    useVoiceInputMock.mockReturnValue(baseVoice({ status: 'loading' }));
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-hold-button')).toBeDisabled();
    expect(screen.getByText('Loading voice model…')).toBeInTheDocument();
  });

  it('shows an inline error (permission denied / load-fail) and disables both buttons', () => {
    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'error', error: 'microphone unavailable' }),
    );
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-hold-button')).toBeDisabled();
    expect(screen.getByTestId('mic-tap-toggle-button')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'microphone unavailable',
    );
  });

  it('calls startHold/stopHold on pointerdown/pointerup of the hold button', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    const button = screen.getByTestId('mic-hold-button');
    fireEvent.pointerDown(button);
    expect(voice.startHold).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button);
    expect(voice.stopHold).toHaveBeenCalledTimes(1);
  });

  it('calls startHold/stopHold on keydown(Space)/keyup(Space) of the hold button, ignoring key-repeat', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    const button = screen.getByTestId('mic-hold-button');
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ', repeat: true });
    expect(voice.startHold).toHaveBeenCalledTimes(1); // repeat ignored
    fireEvent.keyUp(button, { key: ' ' });
    expect(voice.stopHold).toHaveBeenCalledTimes(1);
  });

  it('calls toggleTap on a click of the tap-toggle button', () => {
    const voice = baseVoice();
    useVoiceInputMock.mockReturnValue(voice);
    render(<MicButton onFinal={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mic-tap-toggle-button'));
    expect(voice.toggleTap).toHaveBeenCalledTimes(1);
  });

  it('renders the waveform while listening, driven by the hook level', () => {
    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'listening', level: 0.7 }),
    );
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('voice-waveform')).toBeInTheDocument();
  });

  it('renders the interim busy indicator while transcribing (C3 — wires the previously-dead interim signal)', () => {
    useVoiceInputMock.mockReturnValue(
      baseVoice({ status: 'transcribing', interim: '…' }),
    );
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByTestId('mic-interim')).toHaveTextContent('…');
  });

  it('shows a subtle CPU-mode hint when WebGPU is absent (D9 — invisible-beyond-load degrade)', () => {
    vi.stubGlobal('navigator', {});
    useVoiceInputMock.mockReturnValue(baseVoice());
    render(<MicButton onFinal={vi.fn()} />);
    expect(screen.getByText('(CPU mode)')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
