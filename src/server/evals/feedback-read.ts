import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FeedbackRating } from '../../contracts/enums.ts';
import { readSpans } from '../../run/run-trace.ts';
import { ATTR } from '../../telemetry/spans.ts';

/**
 * Slice 32 Evals/Health surface (Task 20) — reads the `chat.feedback` spans
 * `recordChatFeedback` writes (`src/telemetry/spans.ts`) across EVERY run
 * journal under `runsRoot` and counts 👎 (`FeedbackRating.Down`). Mirrors
 * `readDegrades` (`src/run/run-dto.ts`): one journal at a time via `readSpans`
 * (already tolerant of a missing/malformed `spans.jsonl`), plus an outer
 * per-run try/catch so one unreadable run journal can never fail the whole
 * scan (the same isolation `handleRunList` applies to `summarizeRunListItem`).
 *
 * This is the real (unattributed) count — see `readThumbsDownByArtifact`
 * below for why it cannot be split per artifact yet.
 */
export async function countThumbsDownTotal(runsRoot: string): Promise<number> {
  let dirs: string[];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return 0;
  }
  let total = 0;
  for (const id of dirs) {
    try {
      const { spans } = await readSpans(join(runsRoot, id));
      for (const span of spans) {
        if (
          span.name === 'chat.feedback' &&
          span.attributes[ATTR.FEEDBACK_RATING] === FeedbackRating.Down
        ) {
          total += 1;
        }
      }
    } catch {
      // Isolate one unreadable run journal; feedback is a secondary signal.
    }
  }
  return total;
}

/**
 * Per-artifact 👎 count for `EvalHealthDTO.thumbsDown` (Task 20 brief).
 *
 * ATTRIBUTION GAP (documented, not invented): `recordChatFeedback` persists
 * only `{messageId, rating}` on the `chat.feedback` span — there is no
 * messageId→artifactId (nor even messageId→run) join anywhere in the
 * codebase today (`ChatMessageDTO`, `src/contracts/dto.ts`, carries no
 * artifact ref either). So a 👎 CANNOT be attributed to the generated
 * artifact that produced it, and this always returns an EMPTY map —
 * `health.ts` defaults every artifact's `thumbsDown` to 0 rather than
 * guessing an attribution. `countThumbsDownTotal` above proves the real
 * signal is readable; closing the attribution gap is a follow-on: persist
 * the artifact ref alongside the feedback span (or the chat message) at
 * record time, then this function's body changes to key its result by that
 * ref instead of returning `{}` unconditionally.
 */
export async function readThumbsDownByArtifact(
  _runsRoot: string,
): Promise<Record<string, number>> {
  return {};
}
