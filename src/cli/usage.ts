import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readSpans } from '../run/run-trace.ts';
import type { SpanRecord } from '../telemetry/jsonl-exporter.ts';
import { aggregateSpans, renderUsage } from '../usage/aggregate.ts';

function runsRootDir(): string {
  return process.env.AGENT_RUNS_ROOT ?? 'runs';
}

/** Read every run under runsRoot and roll their spans up into usage rows.
 *  A missing/unreadable runs dir degrades to an empty list, never throws. */
export async function collectUsage(runsRoot: string): Promise<SpanRecord[]> {
  let ids: string[];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const spans: SpanRecord[] = [];
  for (const id of ids) {
    const { spans: runSpans } = await readSpans(join(runsRoot, id));
    spans.push(...runSpans);
  }
  return spans;
}

async function main(): Promise<void> {
  const root = runsRootDir();
  const spans = await collectUsage(root);
  const rows = aggregateSpans(spans);
  process.stdout.write(`${renderUsage(rows)}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
