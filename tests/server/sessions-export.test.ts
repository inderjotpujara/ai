import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatRole } from '../../src/contracts/enums.ts';
import type { MemoryStore } from '../../src/memory/store.ts';
import { buildFetch, type ServerDeps } from '../../src/server/app.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import type { RunCrewTurn } from '../../src/server/crews/run.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';
import {
  handleSessionExport,
  renderSessionMarkdown,
} from '../../src/server/sessions/export.ts';
import type { RunWorkflowTurn } from '../../src/server/workflows/run.ts';
import {
  createSessionStore,
  type SessionStore,
} from '../../src/session/store.ts';

test('renderSessionMarkdown assembles a heading per message with ISO timestamps', () => {
  const md = renderSessionMarkdown({ id: 's1', title: 'My chat' }, [
    {
      id: 'm1',
      role: ChatRole.User,
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: 0,
    },
    {
      id: 'm2',
      role: ChatRole.Assistant,
      parts: [{ type: 'text', text: 'hi there' }],
      createdAt: 1000,
      degraded: true,
    },
  ]);
  expect(md).toContain('# My chat');
  expect(md).toContain('## User — 1970-01-01T00:00:00.000Z');
  expect(md).toContain('hello');
  expect(md).toContain('## Assistant — 1970-01-01T00:00:01.000Z');
  expect(md).toContain('_(degraded)_');
  expect(md).toContain('hi there');
});

test('renderSessionMarkdown falls back to the session id for an empty title, and marks an empty message', () => {
  const md = renderSessionMarkdown({ id: 's2', title: '' }, [
    { id: 'm1', role: ChatRole.User, parts: [], createdAt: 0 },
  ]);
  expect(md).toContain('# s2');
  expect(md).toContain('_(empty)_');
});

test('renderSessionMarkdown joins multiple text parts on one message', () => {
  const md = renderSessionMarkdown({ id: 's3', title: 't' }, [
    {
      id: 'm1',
      role: ChatRole.User,
      parts: [
        { type: 'text', text: 'part one ' },
        { type: 'text', text: 'part two' },
      ],
      createdAt: 0,
    },
  ]);
  expect(md).toContain('part one part two');
});

test('handleSessionExport returns 200 text/markdown for an existing session', async () => {
  const deps = {
    sessionStore: {
      getSession: async (id: string) =>
        id === 's1' ? { id: 's1', title: 'My chat' } : undefined,
      getMessages: async () => [
        {
          id: 'm1',
          role: ChatRole.User,
          parts: [{ type: 'text', text: 'hello' }],
          createdAt: 0,
        },
      ],
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double, only the two methods above are called
  } as any;
  const res = await handleSessionExport('s1', deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  const body = await res.text();
  expect(body).toContain('hello');
});

test('handleSessionExport 404s (JSON) for a missing session', async () => {
  const deps = {
    sessionStore: {
      getSession: async () => undefined,
      getMessages: async () => [],
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double
  } as any;
  const res = await handleSessionExport('nope', deps);
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toBe(
    'application/json; charset=utf-8',
  );
  expect(await res.json()).toEqual({ error: 'not found' });
});

// ---------------------------------------------------------------------------
// Real route-ordering regression test (plan Step 6) — reuses the full
// ServerDeps fixture pattern from `tests/server/sessions-routes.test.ts`
// (T25) rather than the plan's stub, per task brief CRITICAL #2.
// ---------------------------------------------------------------------------

const TOKEN = 'a'.repeat(64);
const uploadsDir = mkdtempSync(join(tmpdir(), 'sessions-export-uploads-'));
const runsRoot = mkdtempSync(join(tmpdir(), 'sessions-export-runs-'));
const unusedRunChatTurn: RunChatTurn = async () => {
  throw new Error('unused');
};
const unusedRunCrewTurn: RunCrewTurn = async () => {
  throw new Error('unused');
};
const unusedRunWorkflowTurn: RunWorkflowTurn = async () => {
  throw new Error('unused');
};
const unusedRunBuilderTurn: RunBuilderTurn = async () => {
  throw new Error('unused');
};
const unusedMemoryStore = {
  stats: async () => {
    throw new Error('unused');
  },
  recall: async () => {
    throw new Error('unused');
  },
  ingest: async () => {
    throw new Error('unused');
  },
} as unknown as MemoryStore;

function mcpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-export-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {} }));
  return path;
}

function deps(sessionStore: SessionStore): ServerDeps {
  return {
    token: TOKEN,
    policy: { port: 0, allowedOrigins: [] as string[] },
    recordIo: false,
    indexHtml: '<!doctype html><title>t</title>',
    runChatTurn: unusedRunChatTurn,
    consent: createConsentRegistry(),
    uploadsDir,
    runsRoot,
    runCrewTurn: unusedRunCrewTurn,
    runWorkflowTurn: unusedRunWorkflowTurn,
    runBuilderTurn: unusedRunBuilderTurn,
    runModelPull: async () => {},
    freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    mcpConfigPath: mcpConfigPath(),
    mcpMountStatus: createMcpMountStatus(),
    mountOne: async () => ({ outcome: 'mounted' }),
    memoryStore: unusedMemoryStore,
    sessionStore,
  };
}

function authGet(path: string): Request {
  return new Request(`http://localhost:0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Host: 'localhost:0' },
  });
}

test('the export route wins over the bare :id detail route for the same session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-export-routes-'));
  const store = createSessionStore({ path: dir }, {});
  try {
    store.upsertSession('s1', { defaultTitle: 'My chat', at: 1_000 });
    const fetch = buildFetch(deps(store));

    const exportRes = await fetch(authGet('/api/sessions/s1/export'));
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    const body = await exportRes.text();
    expect(body).toContain('# My chat');

    // Sanity: the bare :id route still returns the JSON SessionDTO, proving
    // export is a distinct route rather than the bare-:id one degrading.
    const detailRes = await fetch(authGet('/api/sessions/s1'));
    expect(detailRes.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
