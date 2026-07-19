export type OriginPolicy = { port: number; allowedOrigins: string[] };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The Host header must name a loopback host — or an explicitly configured
 *  extra host (the bind interface / tunnel host, Slice 24 Incr 5 item 5/12) —
 *  on the configured port (DNS-rebinding defense). */
export function hostAllowed(
  req: Request,
  port: number,
  extraHosts: string[] = [],
): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  return [...LOCAL_HOSTS, ...extraHosts].some((h) => host === `${h}:${port}`);
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
  if (!hostAllowed(req, policy.port)) {
    return new Response('forbidden host', { status: 403 });
  }
  if (!originAllowed(req, policy)) {
    return new Response('forbidden origin', { status: 403 });
  }
  return null;
}
