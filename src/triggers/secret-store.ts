/**
 * Trigger secret store (Slice 25). Resolves a trigger's persisted `secret_ref`
 * POINTER (never a raw secret — see the T5 schema) to the actual secret value
 * used for webhook HMAC verification on the `/hooks/:token` surface.
 *
 * This is the MINIMAL construction the daemon-wiring task (Task 16) needs to
 * lifecycle-bind the engine: the engine only HOLDS and EXPOSES the store, and
 * no consumer resolves a secret until the webhook route lands (Increment 4).
 * The real resolution semantics (env / secure-file lookup) land in Task 18,
 * which extends this factory in place — so the composition roots (daemon +
 * standalone server) already construct it here and Task 18 need only fill in
 * `resolve`.
 */

import type { TriggerSecretStore } from './engine.ts';

/**
 * Builds a trigger secret store. Until Task 18 wires real resolution, every
 * ref resolves to `undefined` (no secret configured) — the fail-closed default:
 * a webhook whose secret cannot be resolved must never verify, never fire.
 */
export function createTriggerSecretStore(
  _opts: Record<never, never> = {},
): TriggerSecretStore {
  return {
    resolve(_secretRef: string): string | undefined {
      return undefined;
    },
  };
}
