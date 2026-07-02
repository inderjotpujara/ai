import type { ProgressTracker } from './progress-tracker.ts';
import { DownloadPhase, type DownloadProgress } from './types.ts';

type OllamaEvent = {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
};
type ParsedLine = {
  phase: DownloadPhase;
  digest?: string;
  completed?: number;
  total?: number;
};

/** Parse one NDJSON line. Detect a layer download by PRESENCE of digest+total+completed. */
export function parseOllamaLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let ev: OllamaEvent;
  try {
    ev = JSON.parse(trimmed) as OllamaEvent;
  } catch {
    return null;
  }
  if (
    ev.digest &&
    typeof ev.total === 'number' &&
    typeof ev.completed === 'number'
  ) {
    return {
      phase: DownloadPhase.Downloading,
      digest: ev.digest,
      completed: ev.completed,
      total: ev.total,
    };
  }
  const s = ev.status ?? '';
  if (s === 'success') return { phase: DownloadPhase.Done };
  if (s.startsWith('verifying')) return { phase: DownloadPhase.Verifying };
  if (s.startsWith('writing') || s.startsWith('removing'))
    return { phase: DownloadPhase.Finalizing };
  return { phase: DownloadPhase.Resolving };
}

/** Stateful aggregator: per-digest replace, sum across digests, feed a ProgressTracker. */
export class OllamaPullAggregator {
  private layers = new Map<string, { completed: number; total: number }>();
  constructor(private readonly tracker: ProgressTracker) {}

  feed(line: string): DownloadProgress | null {
    const parsed = parseOllamaLine(line);
    if (!parsed) return null;
    if (parsed.phase === DownloadPhase.Downloading && parsed.digest) {
      this.layers.set(parsed.digest, {
        completed: parsed.completed ?? 0,
        total: parsed.total ?? 0,
      });
    }
    let completed = 0;
    let total = 0;
    for (const l of this.layers.values()) {
      completed += l.completed;
      total += l.total;
    }
    return this.tracker.update(
      parsed.phase,
      completed,
      total > 0 ? total : null,
    );
  }
}
