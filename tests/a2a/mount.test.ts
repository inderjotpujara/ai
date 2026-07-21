import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AGENTS } from '../../agents/index.ts';
import type { createA2aClient, RemoteAgent } from '../../src/a2a/client.ts';
import { mountRemotes, remoteAsToolSet } from '../../src/a2a/mount.ts';
import {
  A2aMethod,
  type A2aTask,
  TaskStateWire,
} from '../../src/contracts/index.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';

type A2aClient = ReturnType<typeof createA2aClient>;

const OPTS = { toolCallId: 't', messages: [] } as never;

function remote(name: string): RemoteAgent {
  return {
    name,
    baseUrl: `https://${name}.ts.net/api/a2a`,
    cardUrl: `https://${name}.ts.net/.well-known/agent-card.json`,
    token: 'secret',
    pinnedCardHash: 'hash',
  };
}

/** A completed A2A task carrying one text-part artifact. */
function completedTask(text: string): A2aTask {
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    status: { state: TaskStateWire.Completed },
    artifacts: [{ artifactId: 'a-0', parts: [{ kind: 'text', text }] }],
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
    verifyPin: () => Promise.reject(new Error('unused')),
    invoke: (r: RemoteAgent, m: A2aMethod, p: unknown) => {
      calls.push({ method: m, params: p });
      return invoke(r, m, p);
    },
  } as unknown as A2aClient;
  return { client, calls };
}

beforeEach(() => {
  resetBreakers();
});
afterEach(() => {
  process.env.AGENT_BREAKER_THRESHOLD = undefined as unknown as string;
  delete process.env.AGENT_BREAKER_THRESHOLD;
});

test('a remote mounts as delegate_to_<name> and calls message/send on execute', async () => {
  const { client, calls } = fakeClient(() =>
    Promise.resolve(completedTask('the remote answer')),
  );
  const set = remoteAsToolSet(remote('peer'), client);

  const t = set.delegate_to_peer;
  expect(t).toBeDefined();

  const out = (await t?.execute?.({ task: 'do the thing' }, OPTS)) as {
    text?: string;
    error?: string;
  };
  // it invoked message/send, with the task text carried in a message part
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe(A2aMethod.MessageSend);
  const params = calls[0]?.params as {
    message: { parts: { text?: string }[] };
  };
  expect(params.message.parts[0]?.text).toBe('do the thing');
  // and returned the completed artifact text (no throw)
  expect(out.text).toBe('the remote answer');
  expect(out.error).toBeUndefined();
});

test('a failing remote returns a structured error (never throws) + trips the breaker', async () => {
  process.env.AGENT_BREAKER_THRESHOLD = '2';
  const { client, calls } = fakeClient(() =>
    Promise.reject(new Error('peer is down')),
  );
  const set = remoteAsToolSet(remote('deadpeer'), client);
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
