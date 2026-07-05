import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OAuthClientProvider } from '@ai-sdk/mcp';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import type { McpHttpSpec } from '../../src/mcp/client.ts';
import { setServerAuth, tokenStorePath } from '../../src/mcp/token-store.ts';
import {
  McpAuthKind,
  type McpConfig,
  McpTransportKind,
} from '../../src/mcp/types.ts';

const EMPTY_CONFIG = {
  entries: [],
  dormant: [],
  warnings: [],
} as unknown as McpConfig;

const ONE_SERVER_CONFIG: McpConfig = {
  entries: [
    {
      kind: McpTransportKind.Stdio,
      name: 'x',
      command: 'echo',
      args: [],
      env: {},
      raw: { command: 'echo', args: [] },
    },
  ],
  dormant: [],
  warnings: [],
};

describe('withMcpRun', () => {
  it('creates the run, then the mcp.mount span lands in spans.jsonl (ordering fix)', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const seen = await withMcpRun(
      {
        runsRoot,
        runId: 'r1',
        config: EMPTY_CONFIG,
        mountDeps: {
          mount: async () => ({ tools: {}, close: async () => {} }),
        },
      },
      async ({ run, reg }) => {
        expect(run.id).toBe('r1');
        return reg.mounted.length;
      },
    );
    expect(seen).toBe(0);
    const lines = (await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.some((s) => s.name === 'mcp.mount')).toBe(true);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('closes the registry after the body', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    const order: string[] = [];
    let mountedCount = -1;
    await withMcpRun(
      {
        runsRoot,
        runId: 'r2',
        config: ONE_SERVER_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async () => ({
            tools: {},
            close: async () => {
              order.push('close');
            },
          }),
        },
      },
      async ({ reg }) => {
        mountedCount = reg.mounted.length;
        order.push('body');
      },
    );
    // guard: the server actually mounted, so `close` running proves something real happened
    expect(mountedCount).toBe(1);
    // proves BOTH that close ran and that it ran after the body
    expect(order).toEqual(['body', 'close']);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('records mcp.transport=stdio on the per-server mount event for a stdio server', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    await withMcpRun(
      {
        runsRoot,
        runId: 'r3',
        config: ONE_SERVER_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async () => ({ tools: {}, close: async () => {} }),
        },
      },
      async () => {},
    );
    const lines = (await readFile(join(runsRoot, 'r3', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mountSpan = lines.find((s) => s.name === 'mcp.mount');
    const mountEvent = mountSpan?.events?.find(
      (e: { name: string }) => e.name === 'mcp.server.mount',
    );
    expect(mountEvent?.attributes?.['mcp.transport']).toBe('stdio');
    await rm(runsRoot, { recursive: true, force: true });
  });

  const OAUTH_HTTP_CONFIG: McpConfig = {
    entries: [
      {
        kind: McpTransportKind.Http,
        name: 'oauth-server',
        url: 'https://example.test/mcp',
        headers: {},
        auth: { kind: McpAuthKind.OAuth, scopes: ['read'], clientId: 'cid' },
        raw: { type: 'http', url: 'https://example.test/mcp' },
      },
    ],
    dormant: [],
    warnings: [],
  };

  it('auto-builds an authProvider for an OAuth-declared http entry (today undefined → degrade)', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    let received: McpHttpSpec | undefined;
    await withMcpRun(
      {
        runsRoot,
        runId: 'oauth1',
        config: OAUTH_HTTP_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async (spec) => {
            received = spec as McpHttpSpec;
            return { tools: {}, close: async () => {} };
          },
        },
      },
      async () => {},
    );
    expect(received?.authProvider).toBeDefined();
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('a caller-supplied authProvider for that name wins over the auto-built one', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    const callerProvider = {
      tokens: async () => undefined,
      saveTokens: async () => {},
      redirectToAuthorization: () => {},
      saveCodeVerifier: async () => {},
      codeVerifier: async () => 'caller-verifier',
    } as unknown as OAuthClientProvider;
    let received: McpHttpSpec | undefined;
    await withMcpRun(
      {
        runsRoot,
        runId: 'oauth2',
        config: OAUTH_HTTP_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          authProviders: { 'oauth-server': callerProvider },
          mount: async (spec) => {
            received = spec as McpHttpSpec;
            return { tools: {}, close: async () => {} };
          },
        },
      },
      async () => {},
    );
    expect(received?.authProvider).toBe(callerProvider);
    await rm(runsRoot, { recursive: true, force: true });
  });

  const STATIC_HTTP_CONFIG: McpConfig = {
    entries: [
      {
        kind: McpTransportKind.Http,
        name: 'static-server',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer static-token' },
        raw: { type: 'http', url: 'https://example.test/mcp' },
      },
    ],
    dormant: [],
    warnings: [],
  };

  it('emits mcp.auth.outcome=static-key for a static-header http entry', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    await withMcpRun(
      {
        runsRoot,
        runId: 'auth-static',
        config: STATIC_HTTP_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async () => ({ tools: {}, close: async () => {} }),
        },
      },
      async () => {},
    );
    const lines = (
      await readFile(join(runsRoot, 'auth-static', 'spans.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mountSpan = lines.find((s) => s.name === 'mcp.mount');
    const authEvent = mountSpan?.events?.find(
      (e: { name: string }) => e.name === 'mcp.server.auth',
    );
    expect(authEvent?.attributes?.['mcp.server']).toBe('static-server');
    expect(authEvent?.attributes?.['mcp.auth.kind']).toBe('static');
    expect(authEvent?.attributes?.['mcp.auth.outcome']).toBe('static-key');
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('emits mcp.auth.outcome=token-reused for an OAuth entry with a pre-seeded token store', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'xdg-config-'));
    const prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    try {
      setServerAuth(
        'oauth-server',
        { tokens: { access_token: 'seeded-token' } },
        tokenStorePath(),
      );
      const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
      const approvalsFile = join(runsRoot, 'approvals.json');
      await withMcpRun(
        {
          runsRoot,
          runId: 'auth-oauth-reused',
          config: OAUTH_HTTP_CONFIG,
          mountDeps: {
            consent: { autoYes: true },
            approvalsFile,
            mount: async () => ({ tools: {}, close: async () => {} }),
          },
        },
        async () => {},
      );
      const lines = (
        await readFile(
          join(runsRoot, 'auth-oauth-reused', 'spans.jsonl'),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const mountSpan = lines.find((s) => s.name === 'mcp.mount');
      const authEvent = mountSpan?.events?.find(
        (e: { name: string }) => e.name === 'mcp.server.auth',
      );
      expect(authEvent?.attributes?.['mcp.server']).toBe('oauth-server');
      expect(authEvent?.attributes?.['mcp.auth.kind']).toBe('oauth');
      expect(authEvent?.attributes?.['mcp.auth.outcome']).toBe('token-reused');
      await rm(runsRoot, { recursive: true, force: true });
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      await rm(configHome, { recursive: true, force: true });
    }
  });

  it('emits mcp.auth.outcome=authenticated for an OAuth entry with no stored token', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'xdg-config-'));
    const prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    try {
      const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
      const approvalsFile = join(runsRoot, 'approvals.json');
      await withMcpRun(
        {
          runsRoot,
          runId: 'auth-oauth-fresh',
          config: OAUTH_HTTP_CONFIG,
          mountDeps: {
            consent: { autoYes: true },
            approvalsFile,
            mount: async () => ({ tools: {}, close: async () => {} }),
          },
        },
        async () => {},
      );
      const lines = (
        await readFile(
          join(runsRoot, 'auth-oauth-fresh', 'spans.jsonl'),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const mountSpan = lines.find((s) => s.name === 'mcp.mount');
      const authEvent = mountSpan?.events?.find(
        (e: { name: string }) => e.name === 'mcp.server.auth',
      );
      expect(authEvent?.attributes?.['mcp.auth.outcome']).toBe('authenticated');
      await rm(runsRoot, { recursive: true, force: true });
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      await rm(configHome, { recursive: true, force: true });
    }
  });
});
