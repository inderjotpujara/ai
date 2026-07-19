export type OriginPolicy = {
  port: number;
  allowedOrigins: string[];
  /** Extra Host-header hostnames allowed past the DNS-rebinding Host check
   *  beyond loopback — the configured bind interface + tunnel host(s) (Slice 24
   *  Incr 5 item 5/12/13, AGENT_WEB_ALLOWED_HOSTS). Empty/absent = loopback-only
   *  (default-safe); remote reach is an explicit opt-in. */
  allowedHosts?: string[];
};

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The Host header must name a loopback host on the configured port — or an
 *  explicitly configured extra host (the bind interface / tunnel host, Slice 24
 *  Incr 5 item 5/12/13) — else it is rejected (DNS-rebinding defense).
 *
 *  Loopback hosts are matched strictly WITH the configured port. A configured
 *  tunnel/bind host is matched either bare or with the port: a tunnel that
 *  terminates TLS (Tailscale `serve` / Cloudflare) forwards the ORIGINAL Host
 *  header — the tailnet/hostname WITHOUT the loopback port — so a bare match is
 *  required, while a direct bind to that interface still carries `:PORT`. */
export function hostAllowed(
  req: Request,
  port: number,
  extraHosts: string[] = [],
): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  if (LOCAL_HOSTS.some((h) => host === `${h}:${port}`)) return true;
  return extraHosts.some((h) => host === h || host === `${h}:${port}`);
}

/** True when the request's Host header names a LOOPBACK interface — `127.0.0.1`
 *  / `[::1]` / `localhost`, with or without the `:PORT` suffix — as opposed to
 *  an allowlisted tunnel/LAN host (which `hostAllowed` also admits). The
 *  privileged-write gate (`requireTrustedLocal`) and the local-token injection
 *  (main.ts/serveStatic) key on THIS: a request arriving over an allowed tunnel
 *  is not loopback, so it can never be treated as the physically-local browser
 *  even if it presents the `'local'` session token. An absent/empty Host, a
 *  loopback-lookalike (`127.0.0.1.evil.com`), and the bind wildcard `0.0.0.0`
 *  are all NOT loopback. */
export function isLoopbackHost(req: Request): boolean {
  const host = req.headers.get('host');
  if (host === null || host === '') return false;
  const bare = host.replace(/:\d+$/, ''); // strip an optional :PORT ([::1] keeps its brackets)
  return LOCAL_HOSTS.includes(bare);
}

/**
 * A cross-origin Origin is rejected (CSRF / 0.0.0.0-day defense). An absent
 * Origin (same-origin navigation / non-CORS GET) is allowed. Loopback origins
 * on the configured port are always allowed; extra origins come from config
 * (a Slice-24 tunnel adds its origin via AGENT_WEB_ORIGIN_ALLOWLIST).
 */
export function originAllowed(req: Request, policy: OriginPolicy): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  const loopback = LOCAL_HOSTS.map((h) => `http://${h}:${policy.port}`);
  return loopback.includes(origin) || policy.allowedOrigins.includes(origin);
}

/** Returns a 403 Response when the request fails the perimeter, else null. */
export function enforcePerimeter(
  req: Request,
  policy: OriginPolicy,
): Response | null {
  if (!hostAllowed(req, policy.port, policy.allowedHosts ?? [])) {
    return new Response('forbidden host', { status: 403 });
  }
  if (!originAllowed(req, policy)) {
    return new Response('forbidden origin', { status: 403 });
  }
  return null;
}
