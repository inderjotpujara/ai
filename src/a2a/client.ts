/**
 * A2A CONSUME-side remote client (Slice 31, Task 20) — discover / validate /
 * PIN a remote orchestrator's Agent Card, then invoke its exposed skills over
 * JSON-RPC. This is a §7.3 security-sensitive surface: everything a local
 * operator delegates to a remote peer trusts the card this module pinned.
 *
 * Security posture:
 *  - **SSRF guard on EVERY outbound fetch.** Card reads (`discover`,
 *    `verifyPin`) and task invocations (`invoke`) all go through
 *    `noRedirectFetch` (`redirect:'error'` + a defensive 3xx-status reject), so
 *    a card host that redirects — e.g. toward `169.254.169.254` or another
 *    internal address — is REJECTED, never followed.
 *  - **Hash pinning is a HARD gate.** `discover` computes `hashCard(card)` and
 *    returns it as the pin. `verifyPin` re-fetches and, on ANY hash mismatch,
 *    HARD-rejects (`ok:false`) and surfaces it to the caller — it NEVER silently
 *    re-pins (rug-pull / card-spoof defense, §7.3).
 *  - **The remote Bearer is scoped to `remote.baseUrl` only** (sent on `invoke`,
 *    never on discovery), and is never logged nor placed on a span — spans carry
 *    the peer HOST only (Task 2 telemetry contract).
 */

import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/schema.ts';
import {
  type A2aAgentCard,
  A2aMethod,
  AgentCardSchema,
  MessageSchema,
} from '../contracts/index.ts';
import { noRedirectFetch } from '../mcp/http-redirect.ts';
import { hashCard } from './canonical.ts';
import { recordA2aClientDiscover, recordA2aClientInvoke } from './spans.ts';

/** Thrown when a remote response body exceeds `AGENT_A2A_MAX_CARD_BYTES` —
 *  distinct so `discover`/`verifyPin` can surface a precise reason while any
 *  other read failure collapses to a generic "not valid JSON". */
class ResponseTooLargeError extends Error {}

/** A discovered + pinned remote peer. `token` is its A2A Bearer (secret;
 *  sent only to `baseUrl`); `pinnedCardHash` is the hash that must still match
 *  on every subsequent `verifyPin`. */
export type RemoteAgent = {
  name: string;
  baseUrl: string;
  cardUrl: string;
  token: string;
  pinnedCardHash: string;
};

export type DiscoverResult =
  | { ok: true; card: A2aAgentCard; pinnedCardHash: string }
  | { ok: false; reason: string };

/**
 * §7.3 SSRF guard on the persisted invoke endpoint (capstone B4). A discovered
 * card advertises its own `url` (where every future delegation POSTs), but that
 * body is REMOTE-CONTROLLED — a hostile peer could point it at
 * `http://169.254.169.254/…` or another internal service and the daemon would
 * dutifully POST there on each delegation. The only host the operator vouched
 * for is the one in the `cardUrl` they pasted, so the advertised `url` MUST stay
 * on that same host:port. Returns a human-readable reason on mismatch (surfaced
 * to the operator as the add-remote failure), else `undefined`. `URL.host`
 * carries host:port, so a port change is also caught.
 */
export function cardUrlHostMismatch(
  operatorCardUrl: string,
  advertisedUrl: string,
): string | undefined {
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(operatorCardUrl);
  } catch {
    return 'operator cardUrl is not a valid URL';
  }
  try {
    actual = new URL(advertisedUrl);
  } catch {
    return 'card.url is not a valid URL';
  }
  if (actual.host !== expected.host) {
    return (
      `card.url host "${actual.host}" does not match the operator-vouched ` +
      `cardUrl host "${expected.host}" (SSRF guard, §7.3)`
    );
  }
  return undefined;
}

/** Best-effort host extraction for telemetry — HOST only, never the full URL
 *  (Task 2 privacy contract). Falls back to a fixed sentinel for an unparseable
 *  URL so a span attribute is always a bare host. */
function peerHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/**
 * Build the consume-side client. `fetchImpl` is injectable for tests; it is
 * always funnelled through `noRedirectFetch`, so the SSRF guard holds
 * regardless of the impl passed. `timeoutMs` / `maxCardBytes` override the
 * `AGENT_A2A_FETCH_TIMEOUT_MS` / `AGENT_A2A_MAX_CARD_BYTES` config knobs
 * (env-fallback only — never hardcoded at a call site) so the §7.3 DoS guards
 * are testable without touching the process env.
 */
export function createA2aClient(deps?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCardBytes?: number;
}): {
  discover(cardUrl: string): Promise<DiscoverResult>;
  verifyPin(
    remote: RemoteAgent,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  invoke(
    remote: RemoteAgent,
    method: A2aMethod,
    params: unknown,
  ): Promise<unknown>;
} {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const cfg = loadConfig().values;
  const timeoutMs = deps?.timeoutMs ?? Number(cfg.AGENT_A2A_FETCH_TIMEOUT_MS);
  const maxCardBytes =
    deps?.maxCardBytes ?? Number(cfg.AGENT_A2A_MAX_CARD_BYTES);

  /**
   * SSRF-guarded fetch with a §7.3 wall-clock timeout. On timeout it aborts the
   * underlying request AND rejects the returned promise itself — so a hostile
   * peer that hangs the socket cannot stall us even if `fetchImpl` ignores the
   * abort signal (the injected test stub does). `noRedirectFetch` still forces
   * `redirect:'error'`, so the SSRF guard is unaffected.
   */
  function timedFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`a2a fetch timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      noRedirectFetch(
        url,
        { ...init, signal: controller.signal },
        fetchImpl,
      ).then(
        (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /**
   * Read a response body under a hard byte cap, then JSON-parse it. The cap is
   * enforced TWICE (§7.3 memory-exhaustion defense): first by the declared
   * `Content-Length` (fast reject, no bytes read), then by a running count of
   * bytes actually streamed — so a lying or absent `Content-Length` can never
   * slip an unbounded body past the guard; we abort the stream the moment the
   * count crosses the cap instead of buffering it whole.
   */
  async function readCappedJson(res: Response): Promise<unknown> {
    const declared = res.headers.get('content-length');
    if (declared !== null) {
      const n = Number(declared);
      if (Number.isFinite(n) && n > maxCardBytes) {
        throw new ResponseTooLargeError(
          `response body exceeds cap of ${maxCardBytes} bytes (content-length ${declared})`,
        );
      }
    }
    const body = res.body;
    if (body === null) throw new Error('response body is empty');
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > maxCardBytes) {
          throw new ResponseTooLargeError(
            `response body exceeds cap of ${maxCardBytes} bytes (streamed)`,
          );
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  }

  /** GET + parse + validate a card from `cardUrl`, never following a redirect.
   *  Returns the validated card or a failure reason. */
  async function fetchCard(
    cardUrl: string,
  ): Promise<{ ok: true; card: A2aAgentCard } | { ok: false; reason: string }> {
    let res: Response;
    try {
      // redirect:'error' — a redirecting card host is an SSRF risk; reject it.
      // timedFetch adds the §7.3 wall-clock timeout so a hung peer can't stall.
      res = await timedFetch(cardUrl, { redirect: 'error' });
    } catch {
      // A redirect, timeout, or transport failure — never followed / never hangs.
      return {
        ok: false,
        reason: 'card fetch failed (redirect, timeout, or transport)',
      };
    }
    if (res.status !== 200) {
      return { ok: false, reason: `card fetch status ${res.status}` };
    }
    let raw: unknown;
    try {
      // §7.3 size-capped read — an over-cap card body is rejected, never OOM.
      raw = await readCappedJson(res);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        return { ok: false, reason: err.message };
      }
      return { ok: false, reason: 'card body is not valid JSON' };
    }
    // Explicit protocol-version gate (also enforced by the schema literal) so
    // the rejection reason is precise for the operator.
    if (
      raw === null ||
      typeof raw !== 'object' ||
      (raw as Record<string, unknown>).protocolVersion !== '1.0'
    ) {
      return {
        ok: false,
        reason: 'unsupported protocolVersion (expected 1.0)',
      };
    }
    const parsed = AgentCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, reason: 'card failed schema validation' };
    }
    return { ok: true, card: parsed.data };
  }

  async function discover(cardUrl: string): Promise<DiscoverResult> {
    const host = peerHost(cardUrl);
    const result = await fetchCard(cardUrl);
    if (!result.ok) {
      recordA2aClientDiscover({ peerHost: host, outcome: 'rejected' });
      return { ok: false, reason: result.reason };
    }
    const pinnedCardHash = hashCard(result.card);
    recordA2aClientDiscover({ peerHost: host, outcome: 'discovered' });
    return { ok: true, card: result.card, pinnedCardHash };
  }

  async function verifyPin(
    remote: RemoteAgent,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const host = peerHost(remote.cardUrl);
    const result = await fetchCard(remote.cardUrl);
    if (!result.ok) {
      recordA2aClientDiscover({ peerHost: host, outcome: 'rejected' });
      return { ok: false, reason: result.reason };
    }
    const current = hashCard(result.card);
    if (current !== remote.pinnedCardHash) {
      // §7.3 HARD reject — the card changed since it was pinned. NEVER re-pin
      // silently: surface the mismatch to the operator.
      recordA2aClientDiscover({ peerHost: host, outcome: 'pin-mismatch' });
      return {
        ok: false,
        reason: 'card hash mismatch (pin verification failed)',
      };
    }
    recordA2aClientDiscover({ peerHost: host, outcome: 'verified' });
    return { ok: true };
  }

  async function invoke(
    remote: RemoteAgent,
    method: A2aMethod,
    params: unknown,
  ): Promise<unknown> {
    // Client-side guard: a message-bearing method must carry a well-formed
    // Message so we never ship a malformed envelope to the peer.
    if (
      method === A2aMethod.MessageSend ||
      method === A2aMethod.MessageStream
    ) {
      const message = (params as { message?: unknown } | null)?.message;
      if (!MessageSchema.safeParse(message).success) {
        throw new Error('invoke: params.message failed schema validation');
      }
    }

    recordA2aClientInvoke({ peerHost: peerHost(remote.baseUrl), method });

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    });
    // The Bearer is sent ONLY to remote.baseUrl. Freshness headers satisfy the
    // peer's replay guard (Task 16 — x-a2a-timestamp / x-a2a-nonce). The
    // timestamp is in SECONDS: the server (`server/a2a/rpc.ts`) does
    // `Number(tsHeader) * 1000` to convert it to ms before the ±window check, so
    // a milliseconds value here would land ~forever-in-the-future and 409 EVERY
    // authenticated invoke (capstone B1). Emit `Date.now()/1000` to match.
    const res = await timedFetch(remote.baseUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${remote.token}`,
        'x-a2a-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-a2a-nonce': randomUUID(),
      },
      body,
    });
    if (res.status !== 200) {
      throw new Error(`a2a invoke failed: HTTP ${res.status}`);
    }
    // §7.3 size-capped read — an over-cap result body throws (caught by caller),
    // never buffered whole.
    const envelope = (await readCappedJson(res)) as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (envelope.error !== undefined) {
      throw new Error(
        `a2a invoke error ${envelope.error.code}: ${envelope.error.message}`,
      );
    }
    return envelope.result;
  }

  return { discover, verifyPin, invoke };
}
