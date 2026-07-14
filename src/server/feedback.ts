import { FeedbackRequestSchema } from '../contracts/requests.ts';
import { recordChatFeedback } from '../telemetry/spans.ts';
import { json } from './app.ts';

/**
 * `POST /api/feedback` — the web chat's 👍/👎 buttons. Records a
 * `chat.feedback` telemetry span (Slice 31 will consume it to close an eval
 * loop; no eval loop exists yet, this is just the span seam). No `deps` are
 * needed: unlike `handleChat`/`handleRespond`, the span is the only side
 * effect and it's global (not routed through any per-request dependency).
 */
export async function handleFeedback(req: Request): Promise<Response> {
  let body: ReturnType<typeof FeedbackRequestSchema.parse>;
  try {
    body = FeedbackRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid feedback request' }, 400);
  }

  await recordChatFeedback({ messageId: body.messageId, rating: body.rating });
  return json({ ok: true });
}
