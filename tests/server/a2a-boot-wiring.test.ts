import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import { handleTasksCancel } from '../../src/a2a/server.ts';
import { loadConfig } from '../../src/config/schema.ts';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import { buildA2aServerDeps } from '../../src/server/a2a/wire.ts';
import { startWebServer } from '../../src/server/main.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';

const waitFor = async (p: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (p()) return;
    await Bun.sleep(10);
  }
  throw new Error('timeout waiting for condition');
};

const CARD_PATH = '/.well-known/agent-card.json';

// Snapshot every env key this suite mutates so each test restores the process
// environment (loadConfig reads process.env live, so a leaked flag would flip
// the fail-safe for unrelated tests).
const ENV_KEYS = [
  'AGENT_A2A_ENABLED',
  'AGENT_A2A_SKILLS_PATH',
  'AGENT_A2A_TOKENS_PATH',
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

test('buildA2aServerDeps yields the full EXPOSE+CONSUME shape (allowlist+enrollment+jobStore+runsRoot+taskIndex+remotes+client)', () => {
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
    // Increment 6 (Task 20/22, CONSUME side) — now constructed alongside the
    // EXPOSE-side fields, not deferred.
    expect(deps.remotes).toBeDefined();
    expect(deps.client).toBeDefined();
  } finally {
    jobStore.close();
  }
});

test('buildA2aServerDeps threads the worker pool through so A2A tasks/cancel of a RUNNING task can abort the in-flight turn (parity with POST /api/jobs/:id/cancel)', () => {
  process.env.AGENT_A2A_SKILLS_PATH = join(
    mkdtempSync(join(tmpdir(), 'a2a-boot-pool-')),
    'a2a-skills.json',
  );
  const rootTokens = createRootTokenStore({
    path: join(
      mkdtempSync(join(tmpdir(), 'a2a-boot-pool-root-')),
      'daemon-token',
    ),
  });
  const jobStore = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'a2a-boot-pool-queue-')) },
    {},
  );
  const pool = createWorkerPool({
    store: jobStore,
    concurrency: 1,
    dispatch: () => async () => undefined,
  });
  try {
    const cfg = loadConfig().values;
    const deps = buildA2aServerDeps(cfg, {
      jobStore,
      runsRoot: 'runs',
      rootTokens,
      pool,
    });
    // The SAME pool instance is on the deps — so handleTasksCancel's Running
    // branch fires the pool's per-job AbortController, not the bare markCanceled.
    expect(deps.pool).toBe(pool);
  } finally {
    jobStore.close();
  }
});

test('a Running A2A task canceled via the wired pool aborts the turn AND a later settle cannot flip canceled→completed', async () => {
  process.env.AGENT_A2A_SKILLS_PATH = join(
    mkdtempSync(join(tmpdir(), 'a2a-cancel-skills-')),
    'a2a-skills.json',
  );
  const rootTokens = createRootTokenStore({
    path: join(mkdtempSync(join(tmpdir(), 'a2a-cancel-root-')), 'daemon-token'),
  });
  const jobStore = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'a2a-cancel-queue-')) },
    {},
  );
  // A controllable executor: it settles ONLY after `release()` (simulating the
  // model turn finishing AFTER the cancel arrived), and records whether it saw
  // its abort signal fire — proving the cancel actually reached the in-flight
  // turn rather than merely stamping the row Canceled.
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let sawAbort = false;
  const pool = createWorkerPool({
    store: jobStore,
    concurrency: 1,
    pollMs: 5,
    dispatch: () => (_job, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            sawAbort = true;
          },
          { once: true },
        );
        // The turn "completes" (with a would-be Done result) only once released.
        void gate.then(() => resolve({ kind: 'answer', text: 'late result' }));
      }),
  });
  pool.start();
  try {
    const cfg = loadConfig().values;
    const deps = buildA2aServerDeps(cfg, {
      jobStore,
      runsRoot: 'runs',
      rootTokens,
      pool,
    });
    const job = jobStore.enqueue({ kind: JobKind.Chat, payload: {} });
    await waitFor(() => jobStore.getJob(job.id)?.status === JobStatus.Running);

    // taskId === jobId identity — cancel via the A2A dispatch path.
    const res = await handleTasksCancel({ id: job.id }, deps);
    expect(res.ok).toBe(true);
    expect(jobStore.getJob(job.id)?.status).toBe(JobStatus.Canceled);
    expect(sawAbort).toBe(true); // the in-flight turn's signal was aborted

    // The turn now finishes AFTER cancel; the pool's aborted-guard must skip
    // markDone so the row stays Canceled (never regresses to Done/completed).
    release();
    await Bun.sleep(60);
    expect(jobStore.getJob(job.id)?.status).toBe(JobStatus.Canceled);
  } finally {
    release();
    await pool.stop();
    jobStore.close();
  }
});

// --- Regression: the shared-path daemon-boot crash (caught by live-verify) ---
//
// The allowlist persists `{skills:[...]}` (an OBJECT) and the token registry
// persists `[...]` (an ARRAY). When BOTH stores pointed at
// AGENT_A2A_SKILLS_PATH, the moment an operator authored an allowlist the
// enrollment `load()` saw a non-array and threw fail-closed → the whole daemon
// crashed on boot. Every unit test missed it because each store used its own
// isolated temp path; only the real shared-path wiring triggered it. These
// tests exercise the REAL coexistence scenario the fix restores.

test('daemon boots with an AUTHORED allowlist ({skills:[...]}) AND an issued token ([...]) coexisting — separate paths, no fail-closed crash', async () => {
  const skillsPath = join(
    mkdtempSync(join(tmpdir(), 'a2a-coexist-skills-')),
    'a2a-skills.json',
  );
  const tokensPath = join(
    mkdtempSync(join(tmpdir(), 'a2a-coexist-tokens-')),
    'a2a-tokens.json',
  );
  process.env.AGENT_A2A_ENABLED = '1';
  process.env.AGENT_A2A_SKILLS_PATH = skillsPath;
  process.env.AGENT_A2A_TOKENS_PATH = tokensPath;

  // Authored allowlist on disk: the OBJECT shape (`{skills:[...]}`) that used
  // to blow up enrollment's array-only `load()` when the paths were shared.
  writeFileSync(
    skillsPath,
    JSON.stringify({
      skills: [
        {
          skillId: 'fetch-a-url',
          name: 'Fetch a URL',
          description: 'expose the web_fetch agent as an A2A skill',
          kind: 'chat',
          ref: 'web_fetch',
        },
      ],
    }),
  );

  // Shared daemon root so a token issued now verifies against the booted
  // server's enrollment (both resolve the root from the SAME file).
  const authDir = mkdtempSync(join(tmpdir(), 'a2a-coexist-auth-'));
  const rootTokenPath = join(authDir, 'daemon-token');
  const sessionRevocationPath = join(authDir, 'revoked-devices.json');
  const rootTokens = createRootTokenStore({ path: rootTokenPath });

  // Issue a token → writes the ARRAY-shaped registry at the SEPARATE tokens
  // path, so both stores now exist with their incompatible shapes.
  const issuer = createA2aEnrollment({ rootTokens, registryPath: tokensPath });
  const { token } = issuer.issue('ci-peer');

  // The pre-fix shared-path config would have thrown HERE (an object where an
  // array is required); prove that directly so the regression can't silently
  // return.
  expect(() =>
    createA2aEnrollment({ rootTokens, registryPath: skillsPath }),
  ).toThrow(/not a JSON array/);

  // The two knobs must resolve to DISTINCT files — the root cause was sharing.
  const cfg = loadConfig().values;
  expect(String(cfg.AGENT_A2A_SKILLS_PATH)).not.toBe(
    String(cfg.AGENT_A2A_TOKENS_PATH),
  );

  // The real assertion: startWebServer / buildA2aServerDeps must NOT throw with
  // both stores authored, and the card must serve the authored skill.
  const handle = startWebServer({
    port: 0,
    rootTokenPath,
    sessionRevocationPath,
  });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}${CARD_PATH}`);
    expect(res.status).toBe(200);
    const card = (await res.json()) as {
      skills?: Array<{ id: string }>;
    };
    expect(card.skills?.some((s) => s.id === 'fetch-a-url')).toBe(true);

    // And the coexisting issued token verifies against the booted daemon's
    // enrollment (same root, separate registry) — end-to-end proof the two
    // surfaces work side by side.
    const verifier = createA2aEnrollment({
      rootTokens,
      registryPath: tokensPath,
    });
    expect(verifier.verify(token)).toBe(true);
  } finally {
    await handle.pool.stop();
    handle.server.stop(true);
    handle.jobStore.close();
  }
});
