import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { McpMountOne } from '../../src/server/mcp/mount-one.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import { handleMcpTestMount } from '../../src/server/mcp/test-mount.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-testmount-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/mcp/test-mount', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function tmpRunsRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-testmount-runs-'));
}

/** Pull the `outcome` off the terminal `data-run-end` SSE frame (minor #6). */
function runEndOutcome(text: string): string | undefined {
  const idx = text.indexOf('data-run-end');
  if (idx === -1) return undefined;
  return text.slice(idx).match(/"outcome":"([^"]+)"/)?.[1];
}

test('mounts an entry: streams mounting→mounted progress + the terminal DTO', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const mountOne: McpMountOne = async () => ({
    outcome: 'mounted',
    toolCount: 3,
  });

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne,
  });

  const text = await res.text();
  expect(text).toContain('"outcome":"mounting"');
  expect(text).toContain('"outcome":"mounted"');
  expect(text).toContain('data-mcp-server');
  expect(text).toContain('"status":"mounted"');
  // FINAL-REVIEW minor #6: the terminal RunEnd carries the ACTUAL result
  // outcome (not a flat 'done'), mirroring the builder route.
  expect(runEndOutcome(text)).toBe('mounted');
});

test('a declined/failed mount reports "skipped" with a reason, never a 500', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const mountOne: McpMountOne = async () => ({
    outcome: 'skipped',
    reason: 'consent not granted',
  });

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne,
  });

  const text = await res.text();
  expect(res.status).toBe(200);
  expect(text).toContain('"outcome":"skipped"');
  expect(text).toContain('"reason":"consent not granted"');
  // minor #6: a skipped mount ends the run as 'skipped', not 'done'.
  expect(runEndOutcome(text)).toBe('skipped');
});

test('an unknown server name → 404, before any run is minted', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: {} });
  const res = await handleMcpTestMount(req({ name: 'nope' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne: async () => ({ outcome: 'mounted' }),
  });
  expect(res.status).toBe(404);
});

test('malformed body → 400', async () => {
  const res = await handleMcpTestMount(req({ wrong: 1 }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath: writeConfig({ mcpServers: {} }),
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne: async () => ({ outcome: 'mounted' }),
  });
  expect(res.status).toBe(400);
});

test('[ADVERSARIAL] the consent bridge genuinely suspends execute() until resolve() answers it', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const consent = createConsentRegistry();
  let askedOutcome: 'approved' | 'declined' | undefined;
  const mountOne: McpMountOne = async (_entry, opts) => {
    const ok = await opts.ask('Mount "gh"?');
    askedOutcome = ok ? 'approved' : 'declined';
    return ok
      ? { outcome: 'mounted', toolCount: 1 }
      : { outcome: 'skipped', reason: 'declined' };
  };

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent,
    mountOne,
  });

  // Read the stream until the data-confirm frame carrying the promptId
  // lands, then answer it via the registry's resolve() — the SAME mechanism
  // `POST /api/runs/:id/respond` (`handleRespond` → `consent.resolve`) uses.
  const reader = res.body?.getReader();
  if (!reader) throw new Error('expected a streamed body');
  const decoder = new TextDecoder();
  let buffer = '';
  let promptId: string | undefined;
  while (!promptId) {
    const { done, value } = await reader.read();
    if (done)
      throw new Error('stream ended before a data-confirm frame arrived');
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/"promptId":"([a-f0-9]+)"/);
    if (match) promptId = match[1];
  }
  expect(consent.pending()).toContain(promptId);
  expect(askedOutcome).toBeUndefined(); // NOT yet settled — proves the suspend
  consent.resolve(promptId as string, true);

  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  expect(askedOutcome).toBe('approved');
});

test('[REVIEW-FIX a] an abandoned/never-answered consent hits the wall-clock cap → DECLINE terminal (skipped), emits terminal + RunEnd, and execute completes (no hang)', async () => {
  // Fail-closed wall-clock cap: force a tiny confirmWaitMs via the SAME env
  // var `confirmWaitMs()` reads (T11), so the test doesn't wait ~15min.
  const prev = process.env.AGENT_BUILDER_CONFIRM_WAIT_MS;
  process.env.AGENT_BUILDER_CONFIRM_WAIT_MS = '20';
  try {
    const mcpConfigPath = writeConfig({
      mcpServers: { gh: { command: 'bun' } },
    });
    // A consent registry whose port() NEVER settles — the human closed the
    // tab. mountOne awaits ask(); the wall-clock cap must decline it.
    let outcome: boolean | undefined;
    const mountOne: McpMountOne = async (_entry, opts) => {
      outcome = await opts.ask('Mount "gh"?'); // resolves to false on timeout
      return outcome
        ? { outcome: 'mounted', toolCount: 1 }
        : { outcome: 'skipped', reason: 'consent timed out' };
    };

    const res = await handleMcpTestMount(req({ name: 'gh' }), {
      runsRoot: tmpRunsRoot(),
      mcpConfigPath,
      mcpMountStatus: createMcpMountStatus(),
      consent: createConsentRegistry(),
      mountOne,
    });

    // If the cap didn't fire, res.text() would hang and bun's test timeout
    // would fail this test — reaching this line proves execute() completed.
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(outcome).toBe(false); // timed-out consent settled as a DECLINE
    expect(text).toContain('"outcome":"skipped"');
    expect(text).toContain('"reason":"consent timed out"');
    expect(text.match(/data-mcp-server/g)).toHaveLength(1); // terminal once
    expect(text).toContain('data-run-end');
  } finally {
    if (prev === undefined) delete process.env.AGENT_BUILDER_CONFIRM_WAIT_MS;
    else process.env.AGENT_BUILDER_CONFIRM_WAIT_MS = prev;
  }
});

test('[REVIEW-FIX b] a THROWING mount seam still emits a terminal data-mcp-server frame + RunEnd, exactly once', async () => {
  const mcpConfigPath = writeConfig({ mcpServers: { gh: { command: 'bun' } } });
  const mountOne: McpMountOne = async () => {
    throw new Error('reg.close blew up');
  };

  const res = await handleMcpTestMount(req({ name: 'gh' }), {
    runsRoot: tmpRunsRoot(),
    mcpConfigPath,
    mcpMountStatus: createMcpMountStatus(),
    consent: createConsentRegistry(),
    mountOne,
  });

  const text = await res.text();
  expect(res.status).toBe(200); // never a 500 — the throw is caught
  expect(text.match(/data-mcp-server/g)).toHaveLength(1); // terminal EXACTLY once
  expect(text).toContain('"status":"skipped"');
  expect(text).toContain('reg.close blew up'); // error surfaced as the reason
  expect(text).toContain('data-run-end'); // run still reaches a terminal end
  expect(runEndOutcome(text)).toBe('skipped'); // minor #6: not a flat 'done'
});
