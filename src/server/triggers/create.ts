import { randomBytes } from 'node:crypto';
import {
  type TriggerCreateRequest,
  TriggerCreateRequestSchema,
  TriggerCreateResponseSchema,
  TriggerTypeWire,
} from '../../contracts/index.ts';
import type { TriggersEngine } from '../../triggers/engine.ts';
import { computeNextRun } from '../../triggers/next-run.ts';
import { recordTriggerRegister } from '../../triggers/spans.ts';
import {
  type Trigger,
  type TriggerConfig,
  type TriggerInput,
  TriggerOrigin,
  type TriggerTarget,
  type TriggerType,
  type WebhookConfig,
} from '../../triggers/types.ts';
import { hashToken } from '../../triggers/webhook-verify.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import { parseTriggerConfig } from './config-parse.ts';
import { toTriggerDto } from './dto.ts';

export type TriggerCreateDeps = {
  triggers: TriggersEngine;
  policy: OriginPolicy;
  publicBaseUrl: string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * True for a `store.create` failure caused by the `UNIQUE(name, origin)`
 * backstop (bun:sqlite raises `SQLITE_CONSTRAINT_UNIQUE`; matched on `code`
 * with a message fallback in case a different driver ever backs this store).
 * Anything else is a genuine unexpected failure and must propagate to the
 * caller as a 500, not be swallowed into a false 409.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    err.message.includes('UNIQUE constraint failed')
  );
}

/**
 * `POST /api/triggers` — create a console-origin trigger (Slice 25, Task 23).
 * Behind `requireTrustedLocal` FIRST (persistent code-execution-by-schedule is
 * a privileged write, the `handleDevicePair` precedent) — a rejected caller
 * leaves ZERO side effect: nothing parsed, nothing minted, nothing inserted.
 *
 * Order after the gate:
 *  1. Parse the envelope (`TriggerCreateRequestSchema`) — 400 on failure.
 *  2. `parseTriggerConfig(type, config)` — dispatches to the per-type schema +
 *     the cron-pattern / file-path-confinement checks (config-parse.ts). ANY
 *     throw here (bad shape, bad cron, escaping file path) maps to 400.
 *  3. M2 duplicate-name pre-check: `getByName(name, Console)` — a clean 409
 *     BEFORE any token/secret mint or row insert, rather than letting the
 *     store's `UNIQUE(name, origin)` constraint surface as an opaque 500.
 *     Repo-origin rows share the name space only within `origin=repo`, so a
 *     console create can never conflict with a repo def.
 *  4. Webhook only: mint a 128-bit path token server-side, hash it
 *     (`hashToken`, SHA-256 — only the hash is ever persisted), and — when
 *     `config.hmac` — mint an HMAC secret via the secret store. The RAW token
 *     is returned in THIS response ONLY (§7.1) and is NEVER logged/spanned.
 *  5. Cron only: seed `nextRunAt` at create time so a freshly-created cron
 *     doesn't sit un-scheduled until the next boot reconcile.
 *  6. Insert + `recordTriggerRegister` (span carries id/type/origin only —
 *     never the token/secret). `store.create` is wrapped: if it throws (e.g.
 *     the M2 pre-check lost a race and the UNIQUE(name, origin) backstop
 *     fires), any secret minted in step 4 is removed via `secretStore.remove`
 *     BEFORE returning — a thrown create must never orphan a freshly-minted
 *     secret on disk. A UNIQUE failure maps to the same clean 409 shape as
 *     the pre-check; any other error rethrows to the app-level 500 handler.
 *  7. `201` with the DTO, and — webhook only — `webhookToken` + `webhookUrl`
 *     (`${publicBaseUrl}/hooks/${token}`), mirroring `DevicePairResponseSchema`.
 */
export async function handleTriggerCreate(
  req: Request,
  deps: TriggerCreateDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing the body or minting/inserting
  // anything — so a rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: TriggerCreateRequest;
  try {
    body = TriggerCreateRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  let config: TriggerConfig;
  try {
    config = parseTriggerConfig(body.type, body.config);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'invalid config' },
      400,
    );
  }

  // M2: a clean 409 BEFORE any mint/insert — never let the store's UNIQUE
  // constraint surface as an opaque 500.
  if (deps.triggers.store.getByName(body.name, TriggerOrigin.Console)) {
    return json(
      { error: `a console trigger named "${body.name}" already exists` },
      409,
    );
  }

  const input: TriggerInput = {
    name: body.name,
    // TriggerTypeWire <-> TriggerType are isomorphic string enums, guarded by
    // tests/contracts/trigger-enum-parity.test.ts (the `enqueue.ts` idiom).
    type: body.type as unknown as TriggerType,
    enabled: body.enabled,
    target: body.target as unknown as TriggerTarget,
    config,
    origin: TriggerOrigin.Console,
  };

  // Webhook only: server-mint the path token + (if config.hmac) the HMAC
  // secret (§7.1 — never client-supplied). Only the token's SHA-256 is
  // persisted (`token_hash`); the raw token is returned exactly once, below.
  let webhookToken: string | undefined;
  let webhookUrl: string | undefined;
  let tokenHashValue: string | undefined;
  if (body.type === TriggerTypeWire.Webhook) {
    webhookToken = randomBytes(16).toString('hex');
    tokenHashValue = hashToken(webhookToken);
    if ((config as WebhookConfig).hmac) {
      const { secretRef } = deps.triggers.secretStore.mint();
      input.secretRef = secretRef;
    }
    webhookUrl = `${deps.publicBaseUrl}/hooks/${webhookToken}`;
  }

  // Cron only: seed nextRunAt at create time — computeNextRun only reads
  // `t.config`, so a minimal object carrying just the freshly-validated
  // config is sufficient (the trigger row doesn't exist yet).
  if (body.type === TriggerTypeWire.Cron) {
    input.nextRunAt =
      computeNextRun({ config } as Trigger, Date.now()) ?? undefined;
  }

  let trigger: Trigger;
  try {
    trigger = deps.triggers.store.create(
      input,
      tokenHashValue ? { tokenHash: tokenHashValue } : undefined,
    );
  } catch (err) {
    // A minted secret with no row to reference it is an orphan on disk —
    // clean it up before returning/rethrowing, mirroring delete.ts's
    // secret-then-row ordering in reverse.
    if (input.secretRef) {
      deps.triggers.secretStore.remove(input.secretRef);
    }
    if (isUniqueConstraintError(err)) {
      return json(
        { error: `a console trigger named "${body.name}" already exists` },
        409,
      );
    }
    throw err;
  }
  recordTriggerRegister(trigger); // id/type/origin only — never the token/secret.
  return json(
    TriggerCreateResponseSchema.parse({
      trigger: toTriggerDto(trigger, { publicBaseUrl: deps.publicBaseUrl }),
      webhookToken,
      webhookUrl,
    }),
    201,
  );
}
