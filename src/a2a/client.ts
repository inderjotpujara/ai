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
import {
  type A2aAgentCard,
  A2aMethod,
  AgentCardSchema,
  MessageSchema,
} from '../contracts/index.ts';
import { noRedirectFetch } from '../mcp/http-redirect.ts';
import { hashCard } from './canonical.ts';
import { recordA2aClientDiscover, recordA2aClientInvoke } from './spans.ts';

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
 * regardless of the impl passed.
 */
export function createA2aClient(deps?: { fetchImpl?: typeof fetch }): {
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

  /** GET + parse + validate a card from `cardUrl`, never following a redirect.
   *  Returns the validated card or a failure reason. */
  async function fetchCard(
    cardUrl: string,
  ): Promise<{ ok: true; card: A2aAgentCard } | { ok: false; reason: string }> {
    let res: Response;
    try {
      // redirect:'error' — a redirecting card host is an SSRF risk; reject it.
      res = await noRedirectFetch(cardUrl, { redirect: 'error' }, fetchImpl);
    } catch {
      // A redirect (or transport failure) — never followed.
      return { ok: false, reason: 'card fetch failed (redirect or transport)' };
    }
    if (res.status !== 200) {
      return { ok: false, reason: `card fetch status ${res.status}` };
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
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
    // peer's replay guard (Task 16 — x-a2a-timestamp / x-a2a-nonce).
    const res = await noRedirectFetch(
      remote.baseUrl,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${remote.token}`,
          'x-a2a-timestamp': String(Date.now()),
          'x-a2a-nonce': randomUUID(),
        },
        body,
      },
      fetchImpl,
    );
    if (res.status !== 200) {
      throw new Error(`a2a invoke failed: HTTP ${res.status}`);
    }
    const envelope = (await res.json()) as {
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
