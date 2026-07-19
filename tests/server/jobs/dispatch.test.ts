import { expect, test } from 'bun:test';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../../src/queue/types.ts';
import { createJobDispatch } from '../../../src/server/jobs/dispatch.ts';

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
