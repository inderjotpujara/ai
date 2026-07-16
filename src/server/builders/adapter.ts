import type { EventSink } from '../../core/events.ts';
import type { ConfirmPort } from '../consent/registry.ts';

/** Bridges a builder's plain-boolean `confirm` ask to the server's
 *  `ConfirmPort` (D4) — mints a `data-confirm` prompt on the SAME event sink
 *  the build's narration also writes to (§7.1: one connection, not two), and
 *  resolves when `POST /api/runs/:id/respond` answers it. `kind` is fixed per
 *  call site (e.g. `'build'`), unlike `confirmReuseViaPort` below. */
export function confirmViaPort(
  port: ConfirmPort,
  events: EventSink,
  kind: string,
): (question: string) => Promise<boolean> {
  return async (question) => Boolean(await port({ kind, question }, events));
}

/** Same bridge as `confirmViaPort`, but `kind` is supplied PER CALL (the
 *  `ReuseKind` value — `'reuse'`/`'offer'` — the builder passes to
 *  `confirmReuse`), since a single build may ask a reuse question with
 *  either kind depending on the similarity band. */
export function confirmReuseViaPort(
  port: ConfirmPort,
  events: EventSink,
): (kind: string, question: string) => Promise<boolean> {
  return async (kind, question) =>
    Boolean(await port({ kind, question }, events));
}

/** Structurally narrower than the real AI-SDK `UIMessageStreamWriter['write']`
 *  (which accepts many more chunk shapes) — `writer.write` is assignable here
 *  by ordinary function-parameter contravariance, so `logToTextDelta(writer.write)`
 *  type-checks without this module importing `ai`. */
export type TextPartWriter = (
  part:
    | { type: 'text-start'; id: string }
    | { type: 'text-delta'; id: string; delta: string }
    | { type: 'text-end'; id: string },
) => void;

/** Bridges a builder's `log?: (m: string) => void` narration hook to a
 *  `text-delta` part on the SAME writer the confirm ask and terminal result
 *  also use (§7.1) — this is what makes build progress LIVE-visible; the
 *  build's own `agent.build`/`crew.build` spans only flush to `spans.jsonl`
 *  when they close, i.e. at the very end (D7). Each call is its own
 *  start/delta/end text block (a fresh, incrementing id) so the browser
 *  renders one narration line per call instead of one run-on paragraph. */
export function logToTextDelta(write: TextPartWriter): (m: string) => void {
  let n = 0;
  return (m) => {
    const id = `narration-${n++}`;
    write({ type: 'text-start', id });
    write({ type: 'text-delta', id, delta: m });
    write({ type: 'text-end', id });
  };
}
