import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/schema.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { buildA2aServerDeps } from '../../src/server/a2a/wire.ts';
import { startWebServer } from '../../src/server/main.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';

const CARD_PATH = '/.well-known/agent-card.json';

// Snapshot every env key this suite mutates so each test restores the process
// environment (loadConfig reads process.env live, so a leaked flag would flip
// the fail-safe for unrelated tests).
const ENV_KEYS = [
  'AGENT_A2A_ENABLED',
  'AGENT_A2A_SKILLS_PATH',
  'AGENT_QUEUE_PATH',
  'AGENT_TRIGGERS_ENABLED',
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Hermetic queue; triggers OFF so boot opens no scheduler/watcher handle.
  process.env.AGENT_QUEUE_PATH = mkdtempSync(join(tmpdir(), 'a2a-boot-queue-'));
  delete process.env.AGENT_TRIGGERS_ENABLED;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function hermeticAuth(): {
  rootTokenPath: string;
  sessionRevocationPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-boot-auth-'));
  return {
    rootTokenPath: join(dir, 'daemon-token'),
    sessionRevocationPath: join(dir, 'revoked-devices.json'),
  };
}

test('AGENT_A2A_ENABLED on + a temp skills file → server boots with deps.a2a live and serves the card (200, not 503)', async () => {
  process.env.AGENT_A2A_ENABLED = '1';
  process.env.AGENT_A2A_SKILLS_PATH = join(
    mkdtempSync(join(tmpdir(), 'a2a-boot-skills-')),
    'a2a-skills.json',
  );
  const handle = startWebServer({ port: 0, ...hermeticAuth() });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}${CARD_PATH}`);
    expect(res.status).toBe(200);
    const card = (await res.json()) as { name?: string; skills?: unknown[] };
    // A real card body — NOT the 503 deps-unavailable JSON.
    expect(card.name).toBeTruthy();
    expect(Array.isArray(card.skills)).toBe(true);
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
  }
});

test('AGENT_A2A_ENABLED off → deps.a2a undefined and the card route reports unavailable (no card served)', async () => {
  delete process.env.AGENT_A2A_ENABLED; // default off
  const handle = startWebServer({ port: 0, ...hermeticAuth() });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}${CARD_PATH}`);
    // deps.a2a undefined ⇒ the expose surface is dark: the app.ts deps-guard
    // degrades to 503 and NO card is served (never 200, never a card body).
    expect(res.status).not.toBe(200);
    expect([404, 503]).toContain(res.status);
    const body = (await res.json()) as { name?: string; skills?: unknown[] };
    expect(body.name).toBeUndefined();
    expect(body.skills).toBeUndefined();
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
  }
});

test('buildA2aServerDeps yields the EXPOSE-complete shape (allowlist+enrollment+jobStore+runsRoot+taskIndex); remotes/client deferred to T20/T22', () => {
  const skillsPath = join(
    mkdtempSync(join(tmpdir(), 'a2a-boot-wire-')),
    'a2a-skills.json',
  );
  process.env.AGENT_A2A_SKILLS_PATH = skillsPath;
  const rootTokens = createRootTokenStore({
    path: join(mkdtempSync(join(tmpdir(), 'a2a-boot-root-')), 'daemon-token'),
  });
  const jobStore = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'a2a-boot-wire-queue-')) },
    {},
  );
  try {
    const cfg = loadConfig().values;
    const deps = buildA2aServerDeps(cfg, {
      jobStore,
      runsRoot: 'runs',
      rootTokens,
    });
    expect(deps.allowlist).toBeDefined();
    expect(deps.enrollment).toBeDefined();
    expect(deps.jobStore).toBe(jobStore);
    expect(deps.runsRoot).toBe('runs');
    expect(deps.taskIndex).toBeDefined();
    // Increment 6 (Task 20/22, CONSUME side) grows these — absent here.
    expect('remotes' in deps).toBe(false);
    expect('client' in deps).toBe(false);
  } finally {
    jobStore.close();
  }
});
