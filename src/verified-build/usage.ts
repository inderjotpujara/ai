import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { ATTR } from '../telemetry/spans.ts';

export type UsageStat = { lastUsedMs: number; useCount: number };

/** Span attributes that name a built artifact (crew / agent / workflow). */
const ID_ATTRS = [
  ATTR.CREW_ID,
  ATTR.DELEGATION_TARGET,
  ATTR.WORKFLOW_ID,
] as const;

/** Synchronous, tolerant read of one run's spans.jsonl (mirrors
 *  run-trace.ts readSpans, which is async and unusable here). */
function readSpansSync(runDir: string): SpanRecord[] {
  let raw: string;
  try {
    raw = readFileSync(join(runDir, 'spans.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const spans: SpanRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      spans.push(JSON.parse(line) as SpanRecord);
    } catch {
      // skip malformed lines
    }
  }
  return spans;
}

/** Aggregate per-artifact usage (use count + last-used time) from every run's
 *  span trace under runsRoot. Missing root / dirs / files yield {}. */
export function aggregateUsage(runsRoot: string): Record<string, UsageStat> {
  let runIds: string[];
  try {
    runIds = readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return {};
  }
  const usage: Record<string, UsageStat> = {};
  for (const id of runIds) {
    for (const span of readSpansSync(join(runsRoot, id))) {
      for (const key of ID_ATTRS) {
        const value = span.attributes[key];
        if (typeof value !== 'string') continue;
        const stat = usage[value] ?? { lastUsedMs: 0, useCount: 0 };
        stat.useCount += 1;
        stat.lastUsedMs = Math.max(stat.lastUsedMs, span.endUnixNano / 1e6);
        usage[value] = stat;
      }
    }
  }
  return usage;
}
