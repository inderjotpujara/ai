import { expect, test } from 'bun:test';
import { hashCard } from '../../src/a2a/canonical.ts';
import { createA2aClient, type RemoteAgent } from '../../src/a2a/client.ts';
import { type A2aAgentCard, A2aMethod } from '../../src/contracts/index.ts';

const CARD_URL = 'https://peer.ts.net/.well-known/agent-card.json';
const BASE_URL = 'https://peer.ts.net/api/a2a';

function validCard(overrides: Partial<A2aAgentCard> = {}): A2aAgentCard {
  return {
    name: 'peer',
    description: 'a remote peer',
    version: '1.0.0',
    protocolVersion: '1.0',
    url: BASE_URL,
    preferredTransport: 'JSONRPC',
    skills: [{ id: 'ask', name: 'Ask', description: 'qa', tags: [] }],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: { a2aBearer: { type: 'http', scheme: 'bearer' } },
    security: [{ a2aBearer: [] }],
    ...overrides,
  };
}

/** A fetch stub that returns one canned Response and records the calls it saw. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  fetchImpl: typeof fetch;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('discover happy path: validates + pins a 1.0 card', async () => {
  const card = validCard();
  const { fetchImpl } = stubFetch(() => jsonResponse(card));
  const client = createA2aClient({ fetchImpl });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.card.name).toBe('peer');
    expect(res.pinnedCardHash).toBe(hashCard(card));
  }
});

test('discover rejects protocolVersion !== "1.0"', async () => {
  const bad = { ...validCard(), protocolVersion: '0.3' };
  const { fetchImpl } = stubFetch(() => jsonResponse(bad));
  const client = createA2aClient({ fetchImpl });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
});

test('discover blocks a redirecting card host (redirect:error SSRF guard)', async () => {
  // A card host that answers a 3xx must be rejected — never followed to a
  // possibly-internal Location.
  const { fetchImpl, calls } = stubFetch(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      }),
  );
  const client = createA2aClient({ fetchImpl });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
  // The outbound GET was made with redirect:'error' (defense-in-depth).
  expect(calls[0]?.init?.redirect).toBe('error');
});

test('discover rejects a non-200 card response', async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse({ error: 'nope' }, 404));
  const client = createA2aClient({ fetchImpl });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
});

test('verifyPin passes when the re-fetched card still matches the pin', async () => {
  const card = validCard();
  const { fetchImpl } = stubFetch(() => jsonResponse(card));
  const client = createA2aClient({ fetchImpl });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: hashCard(card),
  };
  const res = await client.verifyPin(remote);
  expect(res.ok).toBe(true);
});

test('verifyPin hard-rejects a card whose body changed since the pin (§7.3 rug-pull)', async () => {
  const original = validCard();
  const pinned = hashCard(original);
  // The peer now serves an ALTERED card (extra skill = different hash).
  const altered = validCard({
    skills: [
      { id: 'ask', name: 'Ask', description: 'qa', tags: [] },
      { id: 'evil', name: 'Evil', description: 'exfiltrate', tags: [] },
    ],
  });
  const { fetchImpl } = stubFetch(() => jsonResponse(altered));
  const client = createA2aClient({ fetchImpl });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: pinned,
  };
  const res = await client.verifyPin(remote);
  expect(res.ok).toBe(false); // HARD reject — never a silent re-pin.
});

test('verifyPin blocks a redirecting host too', async () => {
  const { fetchImpl } = stubFetch(() => new Response(null, { status: 301 }));
  const client = createA2aClient({ fetchImpl });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: 'deadbeef',
  };
  const res = await client.verifyPin(remote);
  expect(res.ok).toBe(false);
});

test('invoke POSTs a JSON-RPC message/send to baseUrl with the Bearer + freshness headers', async () => {
  const taskResult = {
    id: 't1',
    contextId: 'c1',
    status: { state: 'submitted' },
    kind: 'task',
  };
  const { fetchImpl, calls } = stubFetch(() =>
    jsonResponse({ jsonrpc: '2.0', id: 1, result: taskResult }),
  );
  const client = createA2aClient({ fetchImpl });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: 'x',
  };
  const message = {
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'hi' }],
    messageId: 'm1',
  };
  const out = await client.invoke(remote, A2aMethod.MessageSend, { message });
  expect(out).toEqual(taskResult);
  const call = calls[0];
  expect(call).toBeDefined();
  if (call === undefined) return;
  expect(call.url).toBe(BASE_URL);
  expect(call.init?.method).toBe('POST');
  const headers = new Headers(call.init?.headers);
  expect(headers.get('authorization')).toBe('Bearer secret-bearer');
  expect(headers.get('x-a2a-timestamp')).toBeTruthy();
  expect(headers.get('x-a2a-nonce')).toBeTruthy();
  const body = JSON.parse(String(call.init?.body));
  expect(body.jsonrpc).toBe('2.0');
  expect(body.method).toBe('message/send');
  expect(body.params.message.messageId).toBe('m1');
});

test('invoke surfaces a JSON-RPC error as a thrown error', async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'nope' },
    }),
  );
  const client = createA2aClient({ fetchImpl });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: 'x',
  };
  const message = {
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'hi' }],
    messageId: 'm1',
  };
  expect(
    client.invoke(remote, A2aMethod.MessageSend, { message }),
  ).rejects.toThrow();
});

// --- §7.3 outbound-fetch DoS hardening (timeout + response-size cap) ---

test('discover rejects a hung peer within the fetch timeout (§7.3 DoS)', async () => {
  // A malicious peer that holds the socket open forever must not stall us: the
  // wall-clock timeout aborts + rejects even though the stub never resolves.
  const fetchImpl = (() =>
    new Promise<Response>(() => {})) as unknown as typeof fetch;
  const client = createA2aClient({ fetchImpl, timeoutMs: 20 });
  const start = Date.now();
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
  expect(Date.now() - start).toBeLessThan(2000); // did not hang
});

test('invoke rejects a hung peer within the fetch timeout (§7.3 DoS)', async () => {
  const fetchImpl = (() =>
    new Promise<Response>(() => {})) as unknown as typeof fetch;
  const client = createA2aClient({ fetchImpl, timeoutMs: 20 });
  const remote: RemoteAgent = {
    name: 'peer',
    baseUrl: BASE_URL,
    cardUrl: CARD_URL,
    token: 'secret-bearer',
    pinnedCardHash: 'x',
  };
  const message = {
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'hi' }],
    messageId: 'm1',
  };
  const start = Date.now();
  await expect(
    client.invoke(remote, A2aMethod.MessageSend, { message }),
  ).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(2000); // did not hang
});

test('discover rejects an over-cap card by declared Content-Length (never buffered whole)', async () => {
  // The (small, valid) card body exceeds a deliberately tiny injected cap; the
  // declared Content-Length lets us reject it before reading a single byte.
  const card = validCard();
  const { fetchImpl } = stubFetch(() => jsonResponse(card));
  const client = createA2aClient({ fetchImpl, maxCardBytes: 10 });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toContain('exceeds');
});

test('discover rejects an over-cap body with a lying/absent Content-Length (streamed byte-count guard)', async () => {
  // A hostile peer streams an UNBOUNDED body with NO Content-Length header —
  // only the running byte count can stop it. The stream never ends on its own,
  // so if the guard buffered the whole body this test would hang forever.
  let pushed = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pushed += 1;
      controller.enqueue(new Uint8Array(64)); // 64 bytes/pull, forever
    },
  });
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;
  const client = createA2aClient({ fetchImpl, maxCardBytes: 256 });
  const res = await client.discover(CARD_URL);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toContain('exceeds');
  // Proof we aborted mid-stream rather than buffering an unbounded body.
  expect(pushed).toBeLessThan(100);
});
