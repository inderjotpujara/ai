/**
 * Fetch for a REMOTE MCP endpoint with redirects treated as errors: a remote
 * MCP server must not be followed through a redirect to an internal address
 * (SSRF defense — architecture.md flagged this). Forces `redirect: 'error'` and
 * defensively rejects a 3xx status if a custom fetch ignores the option.
 */
export async function noRedirectFetch(
  url: string,
  init: RequestInit = {},
  impl: typeof fetch = fetch,
): Promise<Response> {
  const res = await impl(url, { ...init, redirect: 'error' });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`remote MCP redirect rejected (SSRF guard): ${res.status}`);
  }
  return res;
}
