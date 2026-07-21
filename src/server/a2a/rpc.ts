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
 *   "A2A off" from "no such route" — no capability leak.
 * - **A2A-Bearer verification lands in Task 16, at the top of the enabled
 *   handler.** It is a SEPARATE token store from the browser device session
 *   (D5 two-stores split): this route is intentionally routed past the device
 *   session guard, and NOTHING here consults or accepts a device session token
 *   as A2A auth. Until Task 16, the surface is protected solely by
 *   `AGENT_A2A_ENABLED` defaulting off — and the slice never ships an increment
 *   independently, so the pre-Bearer window never reaches main enabled. The
 *   "Task 16 seam" comment inside the enabled handler marks exactly where the
 *   A2A-Bearer check slots in — before any envelope is parsed — without ever
 *   touching the device-session path.
 */

import {
  type A2aRpcResult,
  type A2aServerDeps,
  dispatchA2aRpc,
} from '../../a2a/server.ts';
import { loadConfig } from '../../config/schema.ts';
import { JsonRpcResponseSchema } from '../../contracts/index.ts';

/** JSON-RPC 2.0 Parse Error — the body was not valid JSON at all (distinct from
 *  `-32600` invalid-request, which `dispatchA2aRpc` returns for a well-formed
 *  JSON value that is not a valid envelope). */
const PARSE_ERROR = -32700;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

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

  // ── Task 16 seam ──────────────────────────────────────────────────────────
  // A2A-Bearer verification goes HERE, on `req`'s Authorization header, against
  // the SEPARATE A2A token store (D5) — never the device session store. It
  // returns a JSON-RPC/HTTP error before any envelope is parsed or dispatched.
  // Deliberately absent this task; the enable-gate above is the sole gate until
  // then, and it defaults off.

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

  const id = extractId(body);
  const result = await dispatchA2aRpc(body, deps);
  return rpcResponse(id, result);
}
