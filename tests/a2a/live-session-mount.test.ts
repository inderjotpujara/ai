import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { createA2aClient, RemoteAgent } from '../../src/a2a/client.ts';
import { liveRemoteDelegateTools, mountRemotes } from '../../src/a2a/mount.ts';
import type { ChatDeps } from '../../src/cli/run-chat.ts';
import {
  type ChatSessionDeps,
  runChatSession,
} from '../../src/cli/run-chat-session.ts';
import {
  A2aMethod,
  type A2aTask,
  TaskStateWire,
} from '../../src/contracts/index.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import type { BeforeDelegate } from '../../src/core/delegate.ts';
import type { OrchestratorResult } from '../../src/core/orchestrator.ts';
import type { ResourceCapture } from '../../src/core/resource-capture.ts';
import type { MountedRegistry } from '../../src/mcp/mount.ts';
import type { MediaStore } from '../../src/media/store.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';
import type { RunHandle } from '../../src/run/run-store.ts';

type A2aClient = ReturnType<typeof createA2aClient>;

const OPTS = { toolCallId: 't', messages: [] } as never;
// Tiny poll budget so the send→poll loop never hangs the suite.
const FAST = { taskTimeoutMs: 1_000, pollIntervalMs: 1 };

function remote(name: string): RemoteAgent {
  return {
    name,
    baseUrl: `https://${name}.ts.net/api/a2a`,
    cardUrl: `https://${name}.ts.net/.well-known/agent-card.json`,
    token: 'secret',
    pinnedCardHash: 'hash',
  };
}

function submittedTask(): A2aTask {
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    status: { state: TaskStateWire.Submitted },
    artifacts: [],
    history: [],
    kind: 'task',
  };
}

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

/** A fake client whose send→get lifecycle completes immediately, recording the
 *  task text sent so the test can prove the delegate routed the real prompt. */
function fakeClient(text: string): { client: A2aClient; sends: string[] } {
  const sends: string[] = [];
  const client = {
    discover: () => Promise.reject(new Error('unused')),
    verifyPin: () => Promise.reject(new Error('unused')),
    invoke: (_r: RemoteAgent, m: A2aMethod, p: unknown) => {
      if (m === A2aMethod.MessageSend) {
        const params = p as { message: { parts: { text?: string }[] } };
        sends.push(params.message.parts[0]?.text ?? '');
        return Promise.resolve(submittedTask());
      }
      return Promise.resolve(completedTask(text));
    },
  } as unknown as A2aClient;
  return { client, sends };
}

function fakeDeps(overrides: Partial<ChatSessionDeps> = {}): ChatSessionDeps {
  const registry = { forAgent: () => ({}) } as unknown as MountedRegistry;
  const selectHook: BeforeDelegate = async () => ({});
  const capture: ResourceCapture = {};
  const run: RunHandle = { id: 'r1', dir: '/tmp/does-not-matter' };
  const mediaStore = {} as unknown as MediaStore;
  return { registry, selectHook, capture, run, mediaStore, ...overrides };
}

describe('runChatSession — live A2A remote delegates', () => {
  it('surfaces a configured remote as a delegate_to_<name> tool on the ORCHESTRATOR and routes an invocation through delegateAndPoll', async () => {
    resetBreakers();
    const { client, sends } = fakeClient('the remote answer');
    const remoteTools = mountRemotes([remote('peer')], client, undefined, FAST);

    let captured: Agent | undefined;
    const runChatImpl = async (deps: ChatDeps): Promise<OrchestratorResult> => {
      captured = deps.orchestrator;
      return { kind: 'answer', text: 'ok' };
    };

    await runChatSession({
      task: 'ask the peer',
      deps: fakeDeps({ runChatImpl, remoteTools }),
    });

    // The remote sits in the orchestrator's OWN toolset (peer to local specialists).
    const tool = captured?.tools?.delegate_to_peer;
    expect(tool).toBeDefined();
    // Local composition is untouched — the capability-gap tool is still present.
    expect(captured?.tools?.report_capability_gap).toBeDefined();
    // The routing prompt advertises the remote so the model can pick it.
    expect(captured?.systemPrompt).toContain('delegate_to_peer');

    // Invoking it routes send→poll→completed through delegateAndPoll to the fake.
    const out = (await tool?.execute?.({ task: 'do it' }, OPTS)) as {
      text?: string;
      error?: string;
    };
    expect(out.text).toBe('the remote answer');
    expect(sends).toEqual(['do it']);
  });

  it('flag-off / no remotes → NO remote delegate tools and no prompt change (byte-identical behavior)', async () => {
    let withNone: Agent | undefined;
    await runChatSession({
      task: 'hello',
      deps: fakeDeps({
        runChatImpl: async (deps: ChatDeps) => {
          withNone = deps.orchestrator;
          return { kind: 'answer', text: 'ok' };
        },
      }),
    });
    expect(withNone?.tools?.delegate_to_peer).toBeUndefined();
    expect(withNone?.systemPrompt).not.toContain('delegate_to_peer');
  });

  it('a remote whose name collides with a local specialist does NOT shadow the local (local wins + warn)', async () => {
    resetBreakers();
    const { client } = fakeClient('remote file_qa');
    // "file_qa" is a real local specialist — the remote must not overwrite it.
    const remoteTools = mountRemotes(
      [remote('file_qa')],
      client,
      undefined,
      FAST,
    );
    const warnings: string[] = [];

    let captured: Agent | undefined;
    await runChatSession({
      task: 'x',
      deps: fakeDeps({
        remoteTools,
        onRemoteWarn: (m: string) => warnings.push(m),
        runChatImpl: async (deps: ChatDeps) => {
          captured = deps.orchestrator;
          return { kind: 'answer', text: 'ok' };
        },
      }),
    });
    // The local delegate_to_file_qa is still present (not the remote's tool).
    expect(captured?.tools?.delegate_to_file_qa).toBeDefined();
    expect(warnings.some((w) => w.includes('file_qa'))).toBe(true);
  });
});

describe('liveRemoteDelegateTools — flag gate + fresh store read', () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.AGENT_A2A_ENABLED;
    delete process.env.AGENT_A2A_REMOTES_PATH;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function withRemotesFile(remotes: RemoteAgent[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-remotes-'));
    dirs.push(dir);
    const path = join(dir, 'a2a-remotes.json');
    writeFileSync(path, JSON.stringify(remotes));
    return path;
  }

  it('flag OFF ⇒ {} even with a populated remote store (no wiring, no store read effect)', () => {
    process.env.AGENT_A2A_REMOTES_PATH = withRemotesFile([remote('peer')]);
    delete process.env.AGENT_A2A_ENABLED; // default off
    expect(liveRemoteDelegateTools()).toEqual({});
  });

  it('flag ON + a configured remote ⇒ a delegate_to_<name> ToolSet (fresh read from disk)', () => {
    process.env.AGENT_A2A_REMOTES_PATH = withRemotesFile([remote('peer')]);
    process.env.AGENT_A2A_ENABLED = '1';
    const tools = liveRemoteDelegateTools();
    expect(tools.delegate_to_peer).toBeDefined();
  });

  it('flag ON + empty store ⇒ {} (no tools, no latency)', () => {
    process.env.AGENT_A2A_REMOTES_PATH = withRemotesFile([]);
    process.env.AGENT_A2A_ENABLED = '1';
    expect(liveRemoteDelegateTools()).toEqual({});
  });
});
