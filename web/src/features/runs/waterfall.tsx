import type { SpanDTO } from '@contracts';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import { useState } from 'react';

const WIDTH = 720;
const ROW_H = 22;
const BAR_H = 14;

function barFill(span: SpanDTO): string {
  if (span.status === 'error') return 'var(--color-danger)';
  if (span.degraded) return 'var(--color-signal)';
  return 'var(--color-accent)';
}

export function Waterfall({ spans }: { spans: SpanDTO[] }) {
  const [selected, setSelected] = useState<SpanDTO | undefined>(undefined);
  const maxEnd = Math.max(1, ...spans.map((s) => s.offsetMs + s.durationMs));
  const scale = scaleLinear({ domain: [0, maxEnd], range: [0, WIDTH] });
  const height = Math.max(ROW_H, spans.length * ROW_H);

  return (
    <div className="flex gap-4">
      <svg
        width={WIDTH}
        height={height}
        role="img"
        aria-label="run trace waterfall"
      >
        <Group>
          {spans.map((span, i) => {
            const x = scale(span.offsetMs);
            const w = Math.max(2, scale(span.offsetMs + span.durationMs) - x);
            return (
              <Bar
                key={span.spanId}
                data-testid={`bar-${span.spanId}`}
                x={x}
                y={i * ROW_H + (ROW_H - BAR_H) / 2}
                width={w}
                height={BAR_H}
                rx={3}
                fill={barFill(span)}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(span)}
              />
            );
          })}
        </Group>
      </svg>
      {selected && (
        <aside
          data-testid="span-detail"
          aria-label="Selected span detail"
          className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
          <div className="text-sm">{selected.name}</div>
          {selected.agent && (
            <div className="text-[var(--color-muted)]">
              agent: {selected.agent}
            </div>
          )}
          {selected.model && (
            <div className="text-[var(--color-muted)]">
              model: {selected.model.id}
            </div>
          )}
          {selected.tokens && (
            <div className="text-[var(--color-muted)]">
              tokens: in {selected.tokens.input ?? 0} / out{' '}
              {selected.tokens.output ?? 0}
            </div>
          )}
          <div className="text-[var(--color-muted)]">
            {selected.offsetMs.toFixed(1)}ms + {selected.durationMs.toFixed(1)}
            ms
          </div>
        </aside>
      )}
    </div>
  );
}
