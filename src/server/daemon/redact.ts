const REDACTED = '‹redacted›';

/**
 * Strip any durable-root-token-shaped (`[0-9a-f]{64,}`) or `Bearer <token>`
 * substring from a log line before it leaves the host over HTTP (§7.3). The
 * root token is the disaster-if-leaked secret and a session token authenticates
 * a device — neither may ever appear in a tail response. The hex pass runs
 * FIRST so a `Bearer <64hex>` has its hex redacted too; the Bearer pass then
 * collapses any remaining `Bearer <opaque>` (e.g. a base64url.payload.sig).
 * Both regexes are GLOBAL so every occurrence on a line is redacted, not just
 * the first.
 *
 * The hex pattern intentionally has NO `\b` word-boundary anchors and uses
 * `{64,}` (not `{64}`): `\b` fails to match when the 64-hex secret is glued to
 * an adjacent word char (letter/digit/underscore), e.g. an 80-hex run,
 * `key<64hex>z`, or `zkey_<64hex>` — all of which would otherwise leak
 * un-redacted (§7.3 finding). `{64,}` instead swallows the entire hex run
 * (however long) so a longer embedded run is fully redacted rather than
 * partially matched. For a security scrubber, over-redaction (occasionally
 * eating extra hex chars adjacent to a real secret) is the correct
 * fail-closed tradeoff.
 *
 * The Bearer pattern carries the `i` flag: RFC 7235 makes the auth scheme
 * name case-insensitive, and loggers commonly lowercase header names/values
 * (e.g. `authorization: bearer <token>`), so a case-sensitive match would
 * leak the opaque token on any lowercased line (§7.3 finding).
 */
export function redactSecrets(line: string): string {
  return line
    .replace(/[0-9a-f]{64,}/gi, REDACTED)
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`);
}
