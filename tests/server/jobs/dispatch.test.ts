import { expect, test } from 'bun:test';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../../src/queue/types.ts';
import {
  createJobDispatch,
  EvalMode,
} from '../../../src/server/jobs/dispatch.ts';

const fakeJob = (kind: JobKind, payload: unknown): JobRecord => ({
  id: 'job-1',
  kind,
  payload,
  priority: JobPriority.Normal,
  status: JobStatus.Running,
  attempts: 1,
  maxAttempts: 4,
  createdAt: 0,
  updatedAt: 0,
  startedAt: 0,
  finishedAt: undefined,
  availableAt: 0,
  runId: 'run-xyz',
  result: undefined,
  error: undefined,
  retriedFrom: null,
  origin: undefined,
  chainDepth: 0,
});

const baseDeps = () => ({
  runCrewTurn: async () => ({}),
  getCrew: () => undefined,
  runWorkflowTurn: async () => ({}),
  getWorkflow: () => undefined,
  runModelPull: async () => {},
  runChatTurn: async () => ({ kind: 'answer', text: 'x' }) as never,
  runBuilderTurn: async () => ({}) as never,
});

test('crew dispatch calls runCrewTurn with the job runId', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runCrewTurn: async (i) => {
      calls.push(i);
      return { done: true };
    },
    getCrew: () => ({ name: 'c' }) as never,
  });
  const exec = dispatch(JobKind.Crew);
  const res = await exec(
    fakeJob(JobKind.Crew, { name: 'c', input: 'go' }),
    new AbortController().signal,
  );
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect(res).toEqual({ done: true });
});

test('a crew payload for an unknown crew rejects (terminal-failed)', async () => {
  const dispatch = createJobDispatch(baseDeps());
  await expect(
    dispatch(JobKind.Crew)(
      fakeJob(JobKind.Crew, { name: 'nope', input: 'x' }),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test('a malformed crew payload rejects (terminal-failed)', async () => {
  const dispatch = createJobDispatch({
    ...baseDeps(),
    getCrew: () => ({ name: 'c' }) as never,
  });
  await expect(
    dispatch(JobKind.Crew)(
      fakeJob(JobKind.Crew, { input: 42 }),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test('workflow dispatch calls runWorkflowTurn with the job runId', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runWorkflowTurn: async (i) => {
      calls.push(i);
      return { ok: 1 };
    },
    getWorkflow: () => ({ id: 'w' }) as never,
  });
  const res = await dispatch(JobKind.Workflow)(
    fakeJob(JobKind.Workflow, { name: 'w', input: 'go' }),
    new AbortController().signal,
  );
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect(res).toEqual({ ok: 1 });
});

test('pull dispatch calls runModelPull with the job runId', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runModelPull: async (i) => {
      calls.push(i);
    },
  });
  await dispatch(JobKind.Pull)(
    fakeJob(JobKind.Pull, {
      runtime: 'Ollama',
      provider: 'Ollama',
      modelRef: 'qwen3:8b',
    }),
    new AbortController().signal,
  );
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect((calls[0] as { modelRef: string }).modelRef).toBe('qwen3:8b');
});

test('build dispatch calls runBuilderTurn with the job runId', async () => {
  const calls: unknown[] = [];
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runBuilderTurn: async (i) => {
      calls.push(i);
      return { kind: 'written' } as never;
    },
  });
  await dispatch(JobKind.Build)(
    fakeJob(JobKind.Build, { kind: 'agent', need: 'a summarizer' }),
    new AbortController().signal,
  );
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect((calls[0] as { need: string }).need).toBe('a summarizer');
});

test('chat dispatch threads the pool signal into runChatTurn', async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runChatTurn: async (i) => {
      calls.push(i);
      return { kind: 'answer', text: 'hi' } as never;
    },
  });
  const res = await dispatch(JobKind.Chat)(
    fakeJob(JobKind.Chat, { task: 'hello' }),
    controller.signal,
  );
  expect((calls[0] as { task: string }).task).toBe('hello');
  expect((calls[0] as { signal: AbortSignal }).signal).toBe(controller.signal);
  // T17: the chat executor threads job.runId into RunChatTurn so the chat run
  // dir === job.runId (returned as 202 {runId}) — no longer self-minted.
  expect((calls[0] as { runId: string }).runId).toBe('run-xyz');
  expect(res).toEqual({ kind: 'answer', text: 'hi' });
});

test('B3: a chat job carrying a2aRef runs ONLY that agent via runAgentTurn (NOT the full orchestrator)', async () => {
  const agentCalls: unknown[] = [];
  const chatCalls: unknown[] = [];
  const controller = new AbortController();
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runChatTurn: async (i) => {
      chatCalls.push(i);
      return { kind: 'answer', text: 'orchestrator' } as never;
    },
    runAgentTurn: async (i) => {
      agentCalls.push(i);
      return { kind: 'answer', text: 'single-agent answer' };
    },
  });
  const res = await dispatch(JobKind.Chat)(
    fakeJob(JobKind.Chat, { task: 'summarize', a2aRef: 'file_qa' }),
    controller.signal,
  );
  // Routed to the single-agent runner with the resolved ref — never the full
  // super-agent chat turn (which would expose every specialist + MCP + remotes).
  expect(chatCalls).toHaveLength(0);
  expect(agentCalls).toHaveLength(1);
  expect((agentCalls[0] as { ref: string }).ref).toBe('file_qa');
  expect((agentCalls[0] as { task: string }).task).toBe('summarize');
  expect((agentCalls[0] as { signal: AbortSignal }).signal).toBe(
    controller.signal,
  );
  expect((agentCalls[0] as { runId: string }).runId).toBe('run-xyz');
  expect(res).toEqual({ kind: 'answer', text: 'single-agent answer' });
});

test('B3: a chat job with a2aRef but no runAgentTurn dep fails (never falls through to the orchestrator)', async () => {
  const dispatch = createJobDispatch(baseDeps()); // no runAgentTurn wired
  await expect(
    dispatch(JobKind.Chat)(
      fakeJob(JobKind.Chat, { task: 'x', a2aRef: 'file_qa' }),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/a2aRef/);
});

test('Slice 32: Eval job dispatches to runEvalTurn with the parsed mode/ref/reason/runId', async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runEvalTurn: async (i) => {
      calls.push(i);
      return { kind: 'answer', text: 'ok' } as never;
    },
  });
  const res = await dispatch(JobKind.Eval)(
    fakeJob(JobKind.Eval, {
      mode: 'artifact',
      ref: 'file_qa',
      reason: 'manual',
    }),
    controller.signal,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    mode: EvalMode.Artifact,
    ref: 'file_qa',
    reason: 'manual',
    runId: 'run-xyz',
  });
  expect((calls[0] as { signal: AbortSignal }).signal).toBe(controller.signal);
  expect(res).toEqual({ kind: 'answer', text: 'ok' });
});

test('Slice 32: an Eval job with no runEvalTurn dep wired fails (never a silent no-op)', async () => {
  const dispatch = createJobDispatch(baseDeps()); // no runEvalTurn wired
  await expect(
    dispatch(JobKind.Eval)(
      fakeJob(JobKind.Eval, { mode: 'sweep' }),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/runEvalTurn/);
});

test('Slice 32: an Eval job with mode=artifact and no ref is a permanent defect (schema throws)', async () => {
  const dispatch = createJobDispatch({
    ...baseDeps(),
    runEvalTurn: async () => ({ kind: 'answer', text: 'ok' }) as never,
  });
  await expect(
    dispatch(JobKind.Eval)(
      fakeJob(JobKind.Eval, { mode: 'artifact' }),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/ref required for mode=artifact/);
});
