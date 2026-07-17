import type { ChatRole } from '../../contracts/enums.ts';
import {
  type ChatMessageDTO,
  type SessionDTO,
  SessionDtoSchema,
} from '../../contracts/index.ts';
import type { StoredMessage } from '../../session/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Flatten a stored message's raw `parts` (JSON-decoded, un-typed) into a
 *  single string — mirrors `src/server/chat/task.ts`'s `textOf`, but
 *  defensively: a malformed/legacy row degrades to `''` rather than
 *  throwing, since this reads data this SAME server wrote, not user input,
 *  but must still survive a future schema change to `parts`. */
function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) =>
      p &&
      typeof p === 'object' &&
      'text' in p &&
      typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text
        : '',
    )
    .join('');
}

function toChatMessageDTO(m: StoredMessage): ChatMessageDTO {
  return {
    id: m.id,
    // Stored `role` is a bare string, written only by `handleChat`
    // (Task T26) using `ChatRole`'s own enum values — trusted here rather
    // than re-validated against the enum on every read.
    role: m.role as ChatRole,
    text: partsToText(m.parts),
    ...(m.degraded !== undefined ? { degraded: m.degraded } : {}),
  };
}

/**
 * `GET /api/sessions/:id` — the full `SessionDTO` (session row + transcript),
 * or 404 if the id is unknown. `SessionRow`'s fields are already 1:1 with
 * `SessionListItemDtoSchema`'s (Increment 1's design note) — spread it
 * straight in, add the mapped `messages` (spec §4.2 item 2).
 */
export function handleSessionDetail(id: string, deps: SessionsDeps): Response {
  const row = deps.sessionStore.getSession(id);
  if (!row) return json({ error: 'not found' }, 404);
  const messages = deps.sessionStore.getMessages(id).map(toChatMessageDTO);
  const dto: SessionDTO = { ...row, messages };
  return json(SessionDtoSchema.parse(dto), 200);
}
