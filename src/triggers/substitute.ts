/**
 * §7.3 template substitution — PLAIN string/JSON interpolation, never `eval`,
 * `Function`, or a template engine. A deep recursive walk over any JSON-shaped
 * payload replaces `{{key}}` placeholders inside every STRING leaf with
 * `vars[key]` when the key is present, leaving unknown keys literal (never
 * evaluated). Non-string leaves (numbers, booleans, null) pass through
 * untouched. This is the single interpolation point every trigger source
 * (cron/webhook/file/chain) funnels its payload through via `fire.ts`.
 */

// Matches `{{key}}` with optional inner whitespace; the key is word chars/dots
// only (e.g. `file.path`, `webhook.body`) — no expressions, no function calls.
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function substituteString(s: string, vars: Record<string, string>): string {
  return s.replace(PLACEHOLDER, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : value;
  });
}

/** Deep-walk `payload`, interpolating `{{key}}` in every string leaf. Returns a
 *  structurally-fresh value; the input is not mutated. */
export function substituteTemplate(
  payload: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof payload === 'string') return substituteString(payload, vars);
  if (Array.isArray(payload))
    return payload.map((v) => substituteTemplate(v, vars));
  if (payload !== null && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      out[k] = substituteTemplate(v, vars);
    }
    return out;
  }
  return payload;
}
