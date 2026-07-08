import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';

/** One aggregated row of token/latency usage for a single model, rolled up
 *  across every span that named it via `gen_ai.request.model`. */
export type UsageRow = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  calls: number;
};

/** Group spans by `gen_ai.request.model`, summing tokens/duration/calls.
 *  Missing token attrs are treated as 0 (never NaN); spans with no model
 *  attribute are skipped. Sorted by durationMs desc. */
export function aggregateSpans(spans: SpanRecord[]): UsageRow[] {
  const by = new Map<string, UsageRow>();
  for (const s of spans) {
    const model = s.attributes['gen_ai.request.model'] as string | undefined;
    if (!model) continue;
    const row = by.get(model) ?? {
      model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      calls: 0,
    };
    row.inputTokens += Number(s.attributes['gen_ai.usage.input_tokens'] ?? 0);
    row.outputTokens += Number(s.attributes['gen_ai.usage.output_tokens'] ?? 0);
    row.durationMs += s.durationMs;
    row.calls += 1;
    by.set(model, row);
  }
  return [...by.values()].sort((a, b) => b.durationMs - a.durationMs);
}

/** Render aggregated usage rows as a fixed-width text table. */
export function renderUsage(rows: UsageRow[]): string {
  const head = 'MODEL                         IN      OUT     MS      CALLS';
  const body = rows.map(
    (r) =>
      `${r.model.padEnd(28)}  ${String(r.inputTokens).padEnd(6)}  ${String(r.outputTokens).padEnd(6)}  ${String(Math.round(r.durationMs)).padEnd(6)}  ${r.calls}`,
  );
  return [head, ...body].join('\n');
}
