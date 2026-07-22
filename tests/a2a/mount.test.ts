import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AGENTS } from '../../agents/index.ts';
import type { createA2aClient, RemoteAgent } from '../../src/a2a/client.ts';
import {
  mountRemotes,
  remoteAsToolSet,
  resetPinVerificationForTest,
} from '../../src/a2a/mount.ts';
import {
  A2aMethod,
  type A2aTask,
  TaskStateWire,
} from '../../src/contracts/index.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';

type A2aClient = ReturnType<typeof createA2aClient>;

const OPTS = { toolCallId: 't', messages: [] } as never;

// Tiny poll budget so the send→poll loop is exercised fast and never hangs the
// suite (the real config defaults are 120s / 1s).
const FAST = { taskTimeoutMs: 1_000, pollIntervalMs: 1 };

function remote(name: string): RemoteAgent {
  return {
    name,
    baseUrl: `https://${name}.ts.net/api/a2a`,
    cardUrl: `https://${name}.ts.net/.well-known/agent-card.json`,
    token: 'secret',
    pinnedCardHash: 'hash',
    skillId: `${name}-skill`,
  };
}

/** A `submitted` task — what `message/send` returns from the produce side. */
function submittedTask(id = 'task-1'): A2aTask {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: TaskStateWire.Submitted },
    artifacts: [],
    history: [],
    kind: 'task',
  };
}

/** A still-`working` task — a `tasks/get` poll before the job finishes. */
function workingTask(id = 'task-1'): A2aTask {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: TaskStateWire.Working },
    artifacts: [],
    history: [],
    kind: 'task',
  };
}

/** A completed A2A task carrying one text-part artifact. */
function completedTask(text: string, id = 'task-1'): A2aTask {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: TaskStateWire.Completed },
    artifacts: [{ artifactId: 'a-0', parts: [{ kind: 'text', text }] }],
    history: [],
    kind: 'task',
  };
}

/** A terminal `failed` task carrying an error message (as the produce side does
 *  for a consent-declined run). */
function failedTask(reason: string, id = 'task-1'): A2aTask {
  return {
    id,
    contextId: 'ctx-1',
    status: {
      state: TaskStateWire.Failed,
      message: {
        role: 'agent',
        messageId: `${id}-error`,
        parts: [{ kind: 'data', data: { error: reason } }],
      },
    },
    artifacts: [],
    history: [],
    kind: 'task',
  };
}

/** A fake client that records every invoke and returns/rejects on demand. */
function fakeClient(
  invoke: (r: RemoteAgent, m: A2aMethod, p: unknown) => Promise<unknown>,
): { client: A2aClient; calls: { method: A2aMethod; params: unknown }[] } {
  const calls: { method: A2aMethod; params: unknown }[] = [];
  const client = {
    discover: () => Promise.reject(new Error('unused')),
    // The live delegate path re-verifies the pin before the first send
    // (capstone B5); default it to OK so these lifecycle tests exercise the
    // send→poll loop. The dedicated B5 tests override it.
    verifyPin: () => Promise.resolve({ ok: true as const }),
    invoke: (r: RemoteAgent, m: A2aMethod, p: unknown) => {
      calls.push({ method: m, params: p });
      return invoke(r, m, p);
    },
  } as unknown as A2aClient;
  return { client, calls };
}

/** Model the REAL A2A lifecycle: `message/send` → `submitted`; the first N
 *  `tasks/get` polls → `working`; the poll after that → `completed`. */
function lifecycleClient(text: string, workingPolls = 1) {
  let gets = 0;
  return fakeClient((_r, method) => {
    if (method === A2aMethod.MessageSend) {
      return Promise.resolve(submittedTask());
    }
    // tasks/get
    gets += 1;
    return Promise.resolve(
      gets <= workingPolls ? workingTask() : completedTask(text),
    );
  });
}

beforeEach(() => {
  resetBreakers();
  resetPinVerificationForTest();
});
afterEach(() => {
  process.env.AGENT_BREAKER_THRESHOLD = undefined as unknown as string;
  delete process.env.AGENT_BREAKER_THRESHOLD;
});

test('delegate polls tasks/get from submitted → working → completed and returns the artifact text', async () => {
  const { client, calls } = lifecycleClient('the remote answer', 1);
  const set = remoteAsToolSet(remote('peer'), client, FAST);

  const t = set.delegate_to_peer;
  expect(t).toBeDefined();

  const out = (await t?.execute?.({ task: 'do the thing' }, OPTS)) as {
    text?: string;
    error?: string;
  };

  // First call is message/send carrying the task text in a message part…
  expect(calls[0]?.method).toBe(A2aMethod.MessageSend);
  const params = calls[0]?.params as {
    message: { parts: { text?: string }[] };
  };
  expect(params.message.parts[0]?.text).toBe('do the thing');

  // …then the loop polled tasks/get (with the submitted task's id) until Completed.
  const getCalls = calls.filter((c) => c.method === A2aMethod.TasksGet);
  expect(getCalls.length).toBeGreaterThanOrEqual(2); // >=1 working + 1 completed
  expect((getCalls[0]?.params as { id?: string }).id).toBe('task-1');

  // The remote's COMPLETED answer is returned (pre-fix code returned {error}).
  expect(out.text).toBe('the remote answer');
  expect(out.error).toBeUndefined();
});

test('delegate sends metadata.skillId = the remote stored skillId on message/send (two-box live-verify defect: -32004 skill not allowed)', async () => {
  const { client, calls } = lifecycleClient('answer', 0);
  const peer = remote('gated'); // skillId === 'gated-skill'
  const set = remoteAsToolSet(peer, client, FAST);

  const out = (await set.delegate_to_gated?.execute?.(
    { task: 'do it' },
    OPTS,
  )) as {
    text?: string;
    error?: string;
  };
  expect(out.text).toBe('answer');

  // The message/send invoke MUST carry the skill-gated peer's stored skillId in
  // params.metadata — a skill-gated EXPOSE peer rejects an absent skillId with
  // JSON-RPC -32004 BEFORE enqueue (§7.4). Pre-fix code sent only { message }.
  const send = calls.find((c) => c.method === A2aMethod.MessageSend);
  expect(send).toBeDefined();
  const params = send?.params as {
    message: unknown;
    metadata?: { skillId?: string };
  };
  expect(params.metadata?.skillId).toBe('gated-skill');
  // tasks/get polling carries NO skill metadata (no skill needed to poll).
  const get = calls.find((c) => c.method === A2aMethod.TasksGet);
  const getParams = get?.params as { metadata?: unknown };
  expect(getParams?.metadata).toBeUndefined();
});

test('a terminal failed remote task returns a structured error (never the text, never a throw)', async () => {
  const { client } = fakeClient((_r, method) =>
    Promise.resolve(
      method === A2aMethod.MessageSend
        ? submittedTask()
        : failedTask('the remote blew up'),
    ),
  );
  const set = remoteAsToolSet(remote('peer'), client, FAST);
  const t = set.delegate_to_peer;

  const out = (await t?.execute?.({ task: 'x' }, OPTS)) as {
    text?: string;
    error?: string;
  };
  expect(out.text).toBeUndefined();
  expect(out.error).toBeDefined();
  expect(out.error).toContain('the remote blew up');
});

test('a remote that never completes times out with a structured error and does NOT hang', async () => {
  // Always `working` → the loop can only exit on the wall-clock budget.
  const { client, calls } = fakeClient((_r, method) =>
    Promise.resolve(
      method === A2aMethod.MessageSend ? submittedTask() : workingTask(),
    ),
  );
  const set = remoteAsToolSet(remote('slowpeer'), client, {
    taskTimeoutMs: 25,
    pollIntervalMs: 1,
  });
  const t = set.delegate_to_slowpeer;

  const out = (await t?.execute?.({ task: 'x' }, OPTS)) as {
    text?: string;
    error?: string;
  };
  expect(out.text).toBeUndefined();
  expect(out.error).toContain('timed out');
  // The loop actually polled before giving up (didn't bail on the first check).
  expect(
    calls.filter((c) => c.method === A2aMethod.TasksGet).length,
  ).toBeGreaterThanOrEqual(1);
});

test('a failing remote returns a structured error (never throws) + trips the breaker', async () => {
  process.env.AGENT_BREAKER_THRESHOLD = '2';
  const { client, calls } = fakeClient(() =>
    Promise.reject(new Error('peer is down')),
  );
  const set = remoteAsToolSet(remote('deadpeer'), client, FAST);
  const t = set.delegate_to_deadpeer;

  // Each failing call RETURNS a structured error rather than throwing.
  const first = (await t?.execute?.({ task: 'x' }, OPTS)) as { error?: string };
  expect(first.error).toContain('peer is down');
  const second = (await t?.execute?.({ task: 'x' }, OPTS)) as {
    error?: string;
  };
  expect(second.error).toBeDefined();
  expect(calls).toHaveLength(2); // both reached invoke (threshold = 2)

  // The breaker is now open: the next call fast-fails WITHOUT reaching invoke.
  const third = (await t?.execute?.({ task: 'x' }, OPTS)) as { error?: string };
  expect(third.error).toContain('circuit open');
  expect(calls).toHaveLength(2); // invoke was NOT called again
});

test('B5: a rug-pulled remote (pin mismatch) returns a structured error and is NEVER invoked, no hang', async () => {
  const invokeMethods: A2aMethod[] = [];
  const client = {
    discover: () => Promise.reject(new Error('unused')),
    // The live re-verify finds the card changed since it was pinned.
    verifyPin: () =>
      Promise.resolve({
        ok: false as const,
        reason: 'card hash mismatch (pin verification failed)',
      }),
    invoke: (_r: RemoteAgent, m: A2aMethod) => {
      invokeMethods.push(m);
      return Promise.resolve(submittedTask());
    },
  } as unknown as A2aClient;

  const set = remoteAsToolSet(remote('rugpull'), client, FAST);
  const out = (await set.delegate_to_rugpull?.execute?.(
    { task: 'x' },
    OPTS,
  )) as {
    text?: string;
    error?: string;
  };

  expect(out.text).toBeUndefined();
  expect(out.error).toBeDefined();
  expect(out.error).toContain('pin verification failed');
  // The peer was NEVER contacted — no message/send, no tasks/get.
  expect(invokeMethods).toEqual([]);
});

test('B5: the pin is re-verified ONCE per process then memoized (not re-fetched every turn)', async () => {
  let verifyCalls = 0;
  let gets = 0;
  const client = {
    discover: () => Promise.reject(new Error('unused')),
    verifyPin: () => {
      verifyCalls += 1;
      return Promise.resolve({ ok: true as const });
    },
    invoke: (_r: RemoteAgent, m: A2aMethod) => {
      if (m === A2aMethod.MessageSend) return Promise.resolve(submittedTask());
      gets += 1;
      return Promise.resolve(completedTask('ok'));
    },
  } as unknown as A2aClient;

  const set = remoteAsToolSet(remote('steady'), client, FAST);
  const t = set.delegate_to_steady;
  const first = (await t?.execute?.({ task: 'a' }, OPTS)) as { text?: string };
  const second = (await t?.execute?.({ task: 'b' }, OPTS)) as { text?: string };

  expect(first.text).toBe('ok');
  expect(second.text).toBe('ok');
  expect(gets).toBeGreaterThanOrEqual(2); // both delegations ran the poll loop
  // …but the card pin was fetched+verified exactly ONCE for the process.
  expect(verifyCalls).toBe(1);
});

test('the mounted tool set feeds forAgent → toolsFor (delegate_to_<name> visible to the orchestrator)', () => {
  const { client } = fakeClient(() => Promise.resolve(completedTask('ok')));
  const merged = mountRemotes([remote('alpha'), remote('beta')], client);
  expect(merged.delegate_to_alpha).toBeDefined();
  expect(merged.delegate_to_beta).toBeDefined();

  // Feed the merged remote set through the SAME `factory(toolsFor(name))` seam
  // createSuperAgent uses (agents/super.ts) — an unscoped `forAgent` slice is
  // visible to the agent it builds, so the delegate tool surfaces unchanged.
  const toolsFor = (_name: string): typeof merged => merged;
  const agent = AGENTS.file_qa?.(toolsFor('file_qa'));
  expect(agent?.tools?.delegate_to_alpha).toBeDefined();
  expect(agent?.tools?.delegate_to_beta).toBeDefined();
});
