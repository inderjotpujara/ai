import type { RootTokenStore } from './root-token.ts';
import type { SessionTokenStore } from './session-token.ts';

/**
 * Break-glass root rotation (D5). Rolls the root (invalidating EVERY outstanding
 * session at once — their HMAC sigs no longer verify against the new key), then
 * re-mints the local browser's own `'local'` session so the operator's current
 * tab survives (anti-self-DoS, §7.1e). The caller (route) clears the device
 * registry and re-confirms the root secret BEFORE invoking this.
 */
export function rotateRoot(deps: {
  rootTokens: RootTokenStore;
  sessionTokens: SessionTokenStore;
  sessionTtlMs: number;
}): { localToken: string } {
  deps.rootTokens.rotate(); // new root — every existing session token is now invalid
  // The live session store was constructed over a root GETTER (T15:
  // `rootToken: () => rootTokens.getOrCreateRoot()`), so it re-reads the CURRENT
  // root on every sign/verify. After the rotate() above, this re-mint therefore
  // signs with the NEW root (verifies under it), while every previously-minted
  // token silently stops verifying — no store rebuild or guard swap needed.
  const localToken = deps.sessionTokens.mintSessionToken({
    deviceId: 'local',
    ttlMs: deps.sessionTtlMs,
  });
  return { localToken };
}
