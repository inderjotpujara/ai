const REDACTED = '‹redacted›';

/**
 * Strip any durable-root-token-shaped (`[0-9a-f]{64}`) or `Bearer <token>`
 * substring from a log line before it leaves the host over HTTP (§7.3). The
 * root token is the disaster-if-leaked secret and a session token authenticates
 * a device — neither may ever appear in a tail response. The hex pass runs
 * FIRST so a `Bearer <64hex>` has its hex redacted too; the Bearer pass then
 * collapses any remaining `Bearer <opaque>` (e.g. a base64url.payload.sig).
 * Both regexes are GLOBAL so every occurrence on a line is redacted, not just
 * the first.
 */
export function redactSecrets(line: string): string {
  return line
    .replace(/\b[0-9a-f]{64}\b/gi, REDACTED)
    .replace(/Bearer\s+\S+/g, `Bearer ${REDACTED}`);
}
