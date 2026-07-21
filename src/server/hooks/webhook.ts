/**
 * `POST /hooks/:token` — the inbound webhook receiver (Slice 25, Task 19,
 * HARD §7.1). This is the ONLY unauthenticated route class in the app: a
 * third-party sender reaches it WITHOUT the browser bearer token, so its own
 * token/HMAC/replay/cap/rate-limit checks ARE the entire security boundary.
 * It sits behind the Host/Origin perimeter (enforced in app.ts before routing)
 * but OUTSIDE the /api session guard.
 *
 * Defense in depth, in order:
 *  1. Token lookup by SHA-256 (`getByTokenHash`) — the DB compares 256-bit
 *     HASHES, never the raw token, so lookup timing leaks nothing exploitable
 *     (an attacker would need a SHA-256 preimage). A miss / non-webhook /
 *     disabled trigger → 404, the SAME shape as any not-found (never reveals
 *     whether the token exists). The RAW token is never logged/spanned/returned.
 *  2. Body cap — reject an over-cap Content-Length BEFORE buffering (a mirror
 *     of /api/telemetry's pre-parse guard; Bun.serve `maxRequestBodySize` is the
 *     runtime backstop). The RAW body is then read ONCE and reused for both HMAC
 *     verification and `{{webhook.body}}` — never re-parsed/re-serialized.
 *  3. HMAC (when `WebhookConfig.hmac`) — HMAC-SHA256 over the raw body keyed by
 *     the trigger's secret, with a ±window replay check (see webhook-verify.ts).
 *     Bad signature → 401; replay-window fail → 409; missing secret → 500.
 *  4. Rate limit — the shared run-dir limiter → 429 on trip.
 *  5. Fire-and-forget — a passing request fires the trigger via fire.ts (the
 *     single convergence point) and acks 202 {jobId, runId}; the job NEVER runs
 *     in the request.
 */

import { loadConfig } from '../../config/schema.ts';
import { withServerRequestSpan } from '../../telemetry/spans.ts';
import type { TriggerSecretStore } from '../../triggers/engine.ts';
import type { FireTrigger } from '../../triggers/fire.ts';
import type { TriggerStore } from '../../triggers/store.ts';
import { TriggerType, type WebhookConfig } from '../../triggers/types.ts';
import { hashToken, verifyHmac } from '../../triggers/webhook-verify.ts';
import { json } from '../app.ts';
import { ALWAYS_ALLOW } from '../run-rate.ts';

const DEFAULT_REPLAY_WINDOW_MS = 5 * 60_000;

export type HandleWebhookDeps = {
  triggerStore: TriggerStore;
  secretStore: TriggerSecretStore;
  fire: FireTrigger;
  /** Shared run-dir rate limiter (defaults to permissive when unset). */
  runLimiter?: { allow(): boolean };
  /** Replay window (ms) — defaults to ±5 minutes. */
  replayWindowMs?: number;
  /** Body-cap override (bytes) — defaults to `AGENT_WEB_MAX_BODY_BYTES`. */
  maxBodyBytes?: number;
};

export function handleWebhook(
  token: string,
  req: Request,
  deps: HandleWebhookDeps,
): Promise<Response> {
  return withServerRequestSpan(
    { route: '/hooks/:token', method: req.method },
    async (rec) => {
      const presentedHash = hashToken(token);
      const trigger = deps.triggerStore.getByTokenHash(presentedHash);
      if (
        !trigger ||
        trigger.type !== TriggerType.Webhook ||
        !trigger.enabled
      ) {
        rec.status(404);
        return json({ error: 'not found' }, 404);
      }

      const cap =
        deps.maxBodyBytes ??
        (loadConfig().values.AGENT_WEB_MAX_BODY_BYTES as number);
      const len = Number(req.headers.get('content-length'));
      if (Number.isFinite(len) && len > cap) {
        rec.status(413);
        return json({ error: 'payload too large' }, 413);
      }
      // Read the RAW body ONCE — reused for HMAC and {{webhook.body}}.
      const rawBody = await req.text();

      const cfg = trigger.config as WebhookConfig;
      if (cfg.hmac) {
        const secret = trigger.secretRef
          ? deps.secretStore.get(trigger.secretRef)
          : undefined;
        if (!secret) {
          rec.status(500);
          return json({ error: 'secret unavailable' }, 500);
        }
        const v = verifyHmac({
          rawBody,
          secret,
          signatureHeader: req.headers.get('x-agent-signature'),
          timestampHeader: req.headers.get('x-agent-timestamp'),
          now: Date.now(),
          windowMs: deps.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS,
        });
        if (!v.ok) {
          rec.status(v.status);
          return json({ error: 'signature rejected' }, v.status);
        }
      }

      const limiter = deps.runLimiter ?? ALWAYS_ALLOW;
      if (!limiter.allow()) {
        rec.status(429);
        return json({ error: 'rate limited' }, 429);
      }

      const result = await deps.fire(trigger, {
        reason: 'webhook',
        vars: { 'webhook.body': rawBody },
      });
      rec.status(202);
      if (!result.fired) {
        return json({ skipped: result.outcome }, 202);
      }
      return json({ jobId: result.jobId, runId: result.runId }, 202);
    },
  );
}
