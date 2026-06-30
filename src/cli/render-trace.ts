import type { RunSummary, TraceNode } from '../run/run-trace.ts';
import { ATTR } from '../telemetry/spans.ts';

function spanLabel(node: TraceNode): string {
  const a = node.span.attributes;
  const bits: string[] = [`${node.span.name} (${node.span.durationMs}ms)`];
  const model = a[ATTR.MODEL_ID];
  if (typeof model === 'string') bits.push(model);
  const target = a[ATTR.DELEGATION_TARGET];
  if (typeof target === 'string') bits.push(`→ ${target}`);
  const outcome = a[ATTR.OUTCOME];
  if (typeof outcome === 'string') bits.push(`[${outcome}]`);
  const inTok = a[ATTR.USAGE_INPUT_TOKENS];
  const outTok = a[ATTR.USAGE_OUTPUT_TOKENS];
  if (typeof inTok === 'number' || typeof outTok === 'number') {
    bits.push(`tok ${inTok ?? '?'}/${outTok ?? '?'}`);
  }
  if (node.span.status.code === 2) bits.push('ERROR');
  return bits.join('  ');
}

function renderNode(node: TraceNode, depth: number, lines: string[]): void {
  lines.push(`${'  '.repeat(depth)}${spanLabel(node)}`);
  for (const child of node.children) renderNode(child, depth + 1, lines);
}

export function renderTimeline(tree: TraceNode[]): string {
  const lines: string[] = [];
  for (const root of tree) renderNode(root, 0, lines);
  return lines.join('\n');
}

export function renderRunList(runs: RunSummary[]): string {
  const sorted = [...runs].sort((a, b) => b.startMs - a.startMs);
  const lines = sorted.map(
    (r) =>
      `${r.id}\t${r.outcome}\t${r.durationMs}ms\t${r.models.join(',') || '-'}`,
  );
  return ['RUN\tOUTCOME\tDURATION\tMODELS', ...lines].join('\n');
}
