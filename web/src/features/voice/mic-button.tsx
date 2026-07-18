import type { KeyboardEvent, PointerEvent } from 'react';
import { isVoiceInputEnabled, voiceModelTier } from '../settings/index.tsx';
import { useVoiceInput } from './use-voice-input.ts';
import { Waveform } from './waveform.tsx';

export type MicButtonProps = {
  onFinal: (text: string) => void;
};

const DEFAULT_SILENCE_MS = 800;
const HOLD_KEYS = new Set([' ', 'Enter']);

function configuredSilenceMs(): number {
  const raw = (globalThis as { __AGENT_VOICE_VAD_SILENCE_MS__?: unknown })
    .__AGENT_VOICE_VAD_SILENCE_MS__;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_SILENCE_MS;
}

function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Composer-mounted voice affordance (spec D2). Two independent elements —
 * deliberately NOT one button trying to disambiguate hold-vs-tap by press
 * duration (undocumented in the design, and genuinely ambiguous): the
 * primary button is real hold-to-talk (`pointerdown`/`up` +
 * `keydown`/`up` on a focusable button), and a small adjacent button
 * starts/stops a VAD-gated tap-to-toggle session. Renders nothing when
 * voice input is disabled in Settings (D7).
 */
export function MicButton({ onFinal }: MicButtonProps) {
  const enabled = isVoiceInputEnabled();
  const voice = useVoiceInput({
    enabled,
    model: voiceModelTier(),
    silenceMs: configuredSilenceMs(),
    onFinal,
  });

  if (!enabled) return null;

  function handleHoldKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key) || event.repeat) return;
    event.preventDefault();
    voice.startHold();
  }

  function handleHoldKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    voice.stopHold();
  }

  function handleHoldPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    voice.startHold();
  }

  function handleHoldPointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    voice.stopHold();
  }

  const busy = voice.status === 'loading';
  const broken = voice.status === 'error';
  const disabled = busy || broken;

  return (
    <div data-testid="mic-button" className="flex items-center gap-2">
      <button
        type="button"
        data-testid="mic-hold-button"
        aria-label="Hold to talk"
        disabled={disabled}
        onPointerDown={handleHoldPointerDown}
        onPointerUp={handleHoldPointerUp}
        onPointerLeave={handleHoldPointerUp}
        onKeyDown={handleHoldKeyDown}
        onKeyUp={handleHoldKeyUp}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)] disabled:opacity-50"
      >
        {voice.status === 'listening' ? '● Listening' : '🎤 Hold'}
      </button>
      <button
        type="button"
        data-testid="mic-tap-toggle-button"
        aria-label="Toggle hands-free listening"
        disabled={disabled}
        onClick={() => voice.toggleTap()}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)] disabled:opacity-50"
      >
        Tap
      </button>
      {voice.status === 'listening' && <Waveform level={voice.level} />}
      {voice.status === 'transcribing' && (
        <span
          data-testid="mic-interim"
          className="text-xs text-[var(--color-muted)]"
        >
          {voice.interim || 'transcribing…'}
        </span>
      )}
      {busy && (
        <span className="text-xs text-[var(--color-muted)]">
          Loading voice model…
        </span>
      )}
      {broken && (
        <span role="alert" className="text-xs text-[var(--color-muted)]">
          {voice.error ?? 'Voice input unavailable'}
        </span>
      )}
      {!disabled && !hasWebGpu() && (
        <span className="text-[10px] text-[var(--color-muted)]">
          (CPU mode)
        </span>
      )}
    </div>
  );
}
