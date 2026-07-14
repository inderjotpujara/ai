import { RespondRequestSchema } from '../../contracts/requests.ts';
import { json, type ServerDeps } from '../app.ts';

/**
 * `POST /api/runs/:id/respond` — the consent channel's read side. Answers a
 * pending `data-confirm` prompt (minted by `ConsentRegistry.port`) with the
 * user's value.
 *
 * `runId` is currently informational only: the registry is server-wide and
 * keyed by the unguessable `promptId`, not scoped per run. Per-run scoping
 * (rejecting a promptId that doesn't belong to `runId`) is deferred to a
 * later phase once runs are individually addressable.
 */
export async function handleRespond(
  req: Request,
  deps: ServerDeps,
  _runId: string,
): Promise<Response> {
  let body: ReturnType<typeof RespondRequestSchema.parse>;
  try {
    body = RespondRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid respond request' }, 400);
  }

  const ok = deps.consent.resolve(body.promptId, body.value);
  return ok ? json({ ok: true }) : json({ error: 'unknown promptId' }, 404);
}
