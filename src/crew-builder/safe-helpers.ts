import type { WorkflowContext } from '../workflow/types.ts';

/** Stringify any ctx value deterministically (strings pass through). */
function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  if (typeof v === 'function' || typeof v === 'symbol') return '';
  if (typeof v === 'bigint') return v.toString();
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

/** input closure: the workflow's initial input. */
export function fromInput(): (ctx: WorkflowContext) => string {
  return (ctx) => asStr(ctx.input);
}
/** input closure: a prior step's output by id. */
export function fromStep(ref: string): (ctx: WorkflowContext) => string {
  return (ctx) => asStr(ctx[ref]);
}
/** input closure: a template with {{ref}} placeholders resolved from ctx. */
export function fromTemplate(
  template: string,
): (ctx: WorkflowContext) => string {
  return (ctx) =>
    template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) =>
      asStr(ctx[k]),
    );
}
/** branch predicate: ref value === value. */
export function whenEquals(
  ref: string,
  value: string,
): (ctx: WorkflowContext) => boolean {
  return (ctx) => asStr(ctx[ref]) === value;
}
/** branch predicate: ref value contains substr. */
export function whenContains(
  ref: string,
  substr: string,
): (ctx: WorkflowContext) => boolean {
  return (ctx) => asStr(ctx[ref]).includes(substr);
}
/** branch predicate: ref value is truthy (non-empty string / truthy value). */
export function whenTruthy(ref: string): (ctx: WorkflowContext) => boolean {
  return (ctx) => Boolean(ctx[ref]) && asStr(ctx[ref]).length > 0;
}
/** map source: a prior step's output as an array (empty when not an array). */
export function mapOver(ref: string): (ctx: WorkflowContext) => unknown[] {
  return (ctx) => (Array.isArray(ctx[ref]) ? (ctx[ref] as unknown[]) : []);
}
