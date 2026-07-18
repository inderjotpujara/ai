type Props = { level: number };

/**
 * A lightweight live level indicator — a single CSS-width-driven bar
 * scaled by `level` (0..1), redrawn on every `useVoiceInput` level tick
 * while listening. No canvas/SVG waveform history in v1 (a forward-item)
 * — a single scaled bar is enough signal that the mic is picking up sound.
 */
export function Waveform({ level }: Props) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <div
      data-testid="voice-waveform"
      role="presentation"
      className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]"
    >
      <div
        className="h-full bg-[var(--color-accent)] transition-[width] duration-75"
        style={{ width: `${Math.round(clamped * 100)}%` }}
      />
    </div>
  );
}
