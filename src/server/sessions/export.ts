import type { ChatRole } from '../../contracts/enums.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

/**
 * A raw stored message, as `SessionStore.getMessages` returns it — the
 * engine-side shape (parsed `parts` JSON), NOT the wire `ChatMessageDTO`
 * projection `GET /api/sessions/:id` uses for rehydrate. Export deliberately
 * reads the raw store, not the DTO (spec D8): Markdown is a one-shot server
 * render, not a live wire contract, so it needs no additional DTO. See the
 * plan's "Assumptions carried from Increments 1–3" note #5 — if Part A's
 * `getMessages` returns a differently-shaped row, only this local type (and
 * `messageText`'s field reads) need adjusting, not this file's structure.
 */
type StoredMessagePart = { type: string; text?: string };
type StoredMessage = {
  id: string;
  role: ChatRole;
  parts: StoredMessagePart[];
  createdAt: number;
  degraded?: boolean;
};

function messageText(parts: StoredMessagePart[]): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

function roleHeading(role: ChatRole): string {
  const s = String(role);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pure Markdown assembly — exported for direct unit testing (no store, no
 * Response plumbing). One `##` heading per message with an ISO timestamp, a
 * `_(degraded)_` marker when the persisted row carries one (spec D7), and an
 * `_(empty)_` placeholder for a message with no text parts.
 */
export function renderSessionMarkdown(
  session: { id: string; title: string },
  messages: StoredMessage[],
): string {
  const lines: string[] = [`# ${session.title || session.id}`, ''];
  for (const m of messages) {
    lines.push(
      `## ${roleHeading(m.role)} — ${new Date(m.createdAt).toISOString()}`,
    );
    if (m.degraded) lines.push('_(degraded)_');
    lines.push('');
    lines.push(messageText(m.parts) || '_(empty)_');
    lines.push('');
  }
  return lines.join('\n');
}

function jsonError(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `GET /api/sessions/:id/export` (spec §4.2 item 5) — the server's FIRST
 * non-JSON API response: `text/markdown`, not `json()`. Reads the session
 * plus its full raw transcript straight from `SessionStore` (never truncated
 * by client-side history — D9's whole point), 404s (JSON, matching every
 * other route's 404 shape) when the session doesn't exist.
 *
 * `SessionStore.getSession`/`getMessages` (Increment 1) are synchronous in
 * this repo — the `await` below is harmless on a non-Promise return (it
 * resolves immediately) and lets this same code serve the async test
 * doubles in `tests/server/sessions-export.test.ts`'s unit tests.
 */
export async function handleSessionExport(
  sessionId: string,
  deps: SessionsDeps,
): Promise<Response> {
  const session = await deps.sessionStore.getSession(sessionId);
  if (!session) return jsonError({ error: 'not found' }, 404);
  const messages = await deps.sessionStore.getMessages(sessionId);
  const md = renderSessionMarkdown(session, messages as StoredMessage[]);
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}
