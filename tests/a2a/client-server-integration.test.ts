/**
 * A2A client↔server bridge test (capstone B1 — replay timestamp unit match).
 *
 * The unit tests exercise the client and the server in isolation; NOTHING drove
 * a real `createA2aClient().invoke(...)` end-to-end into `handleA2aRpc`. That gap
 * let a UNIT MISMATCH ship: the client stamped `x-a2a-timestamp` in
 * MILLISECONDS while the server multiplies the header by 1000 expecting SECONDS,
 * so every authenticated invoke landed ~forever-in-the-future and the replay
 * guard returned 409. This test wires the client's `fetchImpl` straight at the
 * server handler, so a real invoke traverses the exact auth + replay + dispatch
 * path — it MUST fail (409) pre-fix and reach the server (submitted task)
 * post-fix.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { A2aAllowlist, ResolvedTarget } from '../../src/a2a/allowlist.ts';
import { createA2aClient, type RemoteAgent } from '../../src/a2a/client.ts';
import { createA2aEnrollment } from '../../src/a2a/enroll.ts';
import type { A2aServerDeps } from '../../src/a2a/server.ts';
import { createTaskIndex } from '../../src/a2a/task-index.ts';
import { RunOrigin } from '../../src/contracts/enums.ts';
import { A2aMethod } from '../../src/contracts/index.ts';
import type { JobStore } from '../../src/queue/store.ts';
import {
  type JobInput,
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import { handleA2aRpc } from '../../src/server/a2a/rpc.ts';
import { createRootTokenStore } from '../../src/server/security/root-token.ts';

function fakeAllowlist(table: Record<string, ResolvedTarget>): A2aAllowlist {
  return {
    list: () => [],
    put: () => {},
    remove: () => {},
    resolve: (skillId: string) => table[skillId],
  };
}

function fakeJobStore(): { store: JobStore; enqueued: JobInput[] } {
  const jobs = new Map<string, JobRecord>();
  const enqueued: JobInput[] = [];
  let seq = 0;
  const store = {
    enqueue(input: JobInput): JobRecord {
      enqueued.push(input);
      const id = `job-${++seq}`;
      const rec: JobRecord = {
        id,
        kind: input.kind,
        payload: input.payload,
        priority: JobPriority.Normal,
        status: JobStatus.Queued,
        attempts: 0,
        maxAttempts: 1,
        createdAt: 0,
        updatedAt: 0,
        startedAt: undefined,
        finishedAt: undefined,
        availableAt: 0,
        runId: input.runId,
        result: undefined,
        error: undefined,
        retriedFrom: null,
        origin: input.origin,
        chainDepth: 0,
      };
      jobs.set(id, rec);
      return rec;
    },
    getJob: (id: string) => jobs.get(id),
    markCanceled: () => {},
  };
  return { store: store as unknown as JobStore, enqueued };
}

const credDir = mkdtempSync(join(tmpdir(), 'a2a-bridge-cred-'));
const rootTokens = createRootTokenStore({
  path: join(credDir, 'daemon-token'),
});
const enrollment = createA2aEnrollment({
  rootTokens,
  registryPath: join(credDir, 'a2a-tokens.json'),
});
const validToken = enrollment.issue('bridge-peer').token;

const js = fakeJobStore();
const serverDeps: A2aServerDeps = {
  allowlist: fakeAllowlist({ ask: { kind: JobKind.Chat, ref: 'file_qa' } }),
  enrollment,
  jobStore: js.store,
  runsRoot: mkdtempSync(join(tmpdir(), 'a2a-bridge-runs-')),
  taskIndex: createTaskIndex(),
};

/** A client whose transport IS the server handler — no socket, no port. The
 *  client only ever passes a string URL (`remote.baseUrl`) through here. */
const fetchImpl = ((url: string, init?: RequestInit) =>
  handleA2aRpc(new Request(url, init), serverDeps)) as unknown as typeof fetch;
const client = createA2aClient({ fetchImpl });

const remote: RemoteAgent = {
  name: 'peer',
  baseUrl: 'http://peer.local/api/a2a',
  cardUrl: 'http://peer.local/.well-known/agent-card.json',
  token: validToken,
  pinnedCardHash: 'sha256:unused-in-invoke',
};

const message = {
  role: 'user' as const,
  parts: [{ kind: 'text' as const, text: 'summarize this' }],
  messageId: 'm-bridge-1',
  metadata: { skillId: 'ask' },
};

beforeAll(() => {
  process.env.AGENT_A2A_ENABLED = '1';
});
afterAll(() => {
  delete process.env.AGENT_A2A_ENABLED;
});

test('a real client→server invoke is NOT 409 and reaches the server (submitted task)', async () => {
  const result = (await client.invoke(remote, A2aMethod.MessageSend, {
    message,
    metadata: { skillId: 'ask' },
  })) as { kind?: string; status?: { state?: string } };

  // Reached dispatch — a submitted task came back (pre-fix this THREW
  // "a2a invoke failed: HTTP 409" because the ms timestamp skewed into the
  // future and the replay guard rejected it).
  expect(result.kind).toBe('task');
  expect(result.status?.state).toBe('submitted');
  // The server actually enqueued the remote-originated job.
  expect(js.enqueued).toHaveLength(1);
  expect(js.enqueued[0]?.origin).toBe(RunOrigin.Remote);
});
