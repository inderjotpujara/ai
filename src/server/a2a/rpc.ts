/**
 * `POST /api/a2a` — the A2A JSON-RPC endpoint (Slice 31, Task 10). This is the
 * EXPOSE surface a remote orchestrator drives after discovery: it carries the
 * three non-streaming methods (`message/send`, `tasks/get`, `tasks/cancel`) as
 * JSON-RPC 2.0 envelopes and returns a `JsonRpcResponse` echoing the caller's
 * `id`. The route wiring (app.ts) lets this POST past the DEVICE session guard;
 * this module owns the enable-gate + envelope contract.
 *
 * Security posture (why this is a security-sensitive route):
 *
 * - **404 when `AGENT_A2A_ENABLED` is off (fail-safe).** Identical to the card
 *   route: the whole expose surface is dark until an operator enables it, and a
 *   404 (not a 401/403) means a caller past the perimeter cannot distinguish
 *   "A2A off" from "no such route" — no capability leak. `app.ts` (capstone
 *   B7b) returns this SAME featureless 404 when `deps.a2a` is absent too (flag
 *   off ⇒ the dep is never constructed at boot), so an unconfigured route is
 *   never distinguishable from a disabled one via a 503 dep-guard fingerprint.
 * - **A2A-Bearer verification (Task 16), at the top of the enabled handler,
 *   BEFORE the body is parsed.** It is a SEPARATE token store from the browser
 *   device session (D5 two-stores split): this route is intentionally routed
 *   past the device session guard, and NOTHING here consults or accepts a
 *   device session token as A2A auth. The gate is ordered verify-before-parse:
 *   an absent/over-long/bad Bearer → `401` and the JSON-RPC body is NEVER read;
 *   a corrupt token registry (whose `verify` throws, fail-closed) is caught as a
 *   `401` deny, never a 500. Only an authenticated request then runs the replay
 *   guard (`x-a2a-timestamp` + `x-a2a-nonce`, `401`/`409`) and, finally, the
 *   body read + dispatch. The Bearer / timestamp / nonce never appear in a log,
 *   DTO, or span (§7.2).
 */

import { createReplayGuard, type ReplayGuard } from '../../a2a/replay-guard.ts';
import {
  type A2aRpcResult,
  type A2aServerDeps,
  dispatchA2aRpc,
} from '../../a2a/server.ts';
import { loadConfig } from '../../config/schema.ts';
import {
  A2aMethod,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
} from '../../contracts/index.ts';
import { MAX_BEARER_TOKEN_LEN } from '../security/token.ts';
import { handleA2aStream } from './stream-route.ts';

/** JSON-RPC 2.0 Parse Error — the body was not valid JSON at all (distinct from
 *  `-32600` invalid-request, which `dispatchA2aRpc` returns for a well-formed
 *  JSON value that is not a valid envelope). */
const PARSE_ERROR = -32700;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const BEARER_PREFIX = 'Bearer ';

/** The process-wide replay guard fronting `POST /api/a2a`. State (the seen-nonce
 *  LRU) must persist ACROSS requests, so it is a single lazily-built instance
 *  keyed to the configured window — never re-created per request (which would
 *  reset the nonce memory and defeat replay detection). Lazy so the window is
 *  read from live config on first use, not captured at module import. */
let replayGuardSingleton: ReplayGuard | undefined;
function replayGuard(): ReplayGuard {
  if (replayGuardSingleton === undefined) {
    replayGuardSingleton = createReplayGuard(
      Number(loadConfig().values.AGENT_A2A_REPLAY_WINDOW_MS),
    );
  }
  return replayGuardSingleton;
}

/** A bare HTTP auth/freshness rejection. Deliberately featureless (a fixed
 *  status + generic body): the Bearer / timestamp / nonce NEVER appear in the
 *  response, a log, a DTO, or a span (§7.2). */
function reject(status: 401 | 409, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: JSON_HEADERS,
  });
}

/** A JSON-RPC id per the spec: a string, a number, or null (echoed verbatim so a
 *  batching client can correlate the response). */
type JsonRpcId = string | number | null;

/** A featureless 404, identical in shape to the card route's — a caller cannot
 *  distinguish "A2A disabled" from "no such route" (no capability leak). */
function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

/** Best-effort id extraction for the response envelope. The id is echoed even
 *  when the rest of the envelope is invalid, so a client always correlates a
 *  reply; an absent/ill-typed id becomes `null` (JSON-RPC's "no id"). */
function extractId(body: unknown): JsonRpcId {
  if (body !== null && typeof body === 'object') {
    const id = (body as Record<string, unknown>).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

/** Wrap a dispatcher result as a JSON-RPC 2.0 response with the caller's id.
 *  JSON-RPC rides HTTP 200 for both success and application-level errors — the
 *  error lives in the body, not the transport status. */
function rpcResponse(id: JsonRpcId, result: A2aRpcResult): Response {
  const envelope = result.ok
    ? { jsonrpc: '2.0', id, result: result.result }
    : { jsonrpc: '2.0', id, error: result.error };
  return new Response(JSON.stringify(JsonRpcResponseSchema.parse(envelope)), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/**
 * Handle a `POST /api/a2a` JSON-RPC request. The handler owns its own auth
 * posture (see the module header) — it is called from a position PAST the
 * device session guard but STILL behind the Host/Origin perimeter.
 */
export async function handleA2aRpc(
  req: Request,
  deps: A2aServerDeps,
): Promise<Response> {
  // Fail-safe: the expose surface is dark until an operator enables it.
  if (loadConfig().values.AGENT_A2A_ENABLED !== true) return notFound();

  // ── §7.2 inbound auth gate — verify BEFORE parse ────────────────────────────
  // The ordering here IS the security property: an unauthenticated request must
  // be rejected before its body is ever read, so a malformed/hostile body on an
  // unauthenticated request costs us nothing (no parse, no dispatch). The full
  // request-body cap (`maxRequestBodySize`) fronts this handler at `Bun.serve`,
  // yielding a 413 before we run — so this gate need only concern itself with
  // auth + freshness.

  // (1) Extract the Bearer and LENGTH-CAP it up front (token.ts idiom): an
  // over-long or absent header is rejected before any crypto runs, so a giant
  // header can't force unbounded verify work (a cheap DoS guard).
  const authHeader = req.headers.get('authorization');
  if (authHeader === null || !authHeader.startsWith(BEARER_PREFIX)) {
    return reject(401, 'unauthorized');
  }
  const rawToken = authHeader.slice(BEARER_PREFIX.length);
  if (rawToken.length > MAX_BEARER_TOKEN_LEN) {
    return reject(401, 'unauthorized');
  }

  // (2) Verify against the SEPARATE A2A token store (D5) — constant-time, never
  // the device session store. This runs BEFORE the body is read. A corrupt
  // registry makes `verify` THROW (fail-closed, Task 15); the gate catches that
  // as a REJECTION (401 deny), never a 500/crash/unhandled throw.
  let verified: boolean;
  try {
    verified = deps.enrollment.verify(rawToken);
  } catch {
    return reject(401, 'unauthorized');
  }
  if (!verified) return reject(401, 'unauthorized');

  // (3) Replay guard — a verified-but-stale or replayed request is rejected
  // before dispatch. Timestamp header is in SECONDS (→ ms); a missing nonce /
  // unparseable timestamp is a 401 (no freshness proof), stale/replay is a 409.
  const tsHeader = req.headers.get('x-a2a-timestamp');
  const nonce = req.headers.get('x-a2a-nonce') ?? '';
  const tsMs = tsHeader === null ? Number.NaN : Number(tsHeader) * 1000;
  const replay = replayGuard().check(nonce, tsMs);
  if (!replay.ok) return reject(replay.status, 'request rejected');

  // (4) Only now — authenticated AND fresh — read the body and dispatch.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Not JSON at all → a Parse Error with a null id (there is no id to echo).
    return rpcResponse(null, {
      ok: false,
      error: { code: PARSE_ERROR, message: 'parse error' },
    });
  }

  // Streaming methods return an SSE Response (not a JSON-RPC body), so they are
  // routed to the stream route BEFORE the JSON-RPC dispatcher — which only
  // knows the three non-streaming methods and would otherwise -32601 them.
  const envelope = JsonRpcRequestSchema.safeParse(body);
  if (
    envelope.success &&
    (envelope.data.method === A2aMethod.MessageStream ||
      envelope.data.method === A2aMethod.TasksResubscribe)
  ) {
    return handleA2aStream(
      envelope.data.params,
      envelope.data.method,
      req,
      deps,
      envelope.data.id,
    );
  }

  const id = extractId(body);
  const result = await dispatchA2aRpc(body, deps);
  return rpcResponse(id, result);
}
