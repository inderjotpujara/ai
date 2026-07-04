import { describe, expect, test } from 'bun:test';
import type { DryRunDeps } from '../../src/verified-build/dry-run.ts';
import {
  dryRun,
  representativeTask,
  withWallClock,
} from '../../src/verified-build/dry-run.ts';
import type { CapabilitySignature } from '../../src/verified-build/types.ts';
import { ArtifactKind } from '../../src/verified-build/types.ts';

function deps(overrides: Partial<DryRunDeps> = {}): DryRunDeps {
  return {
    runAgent: async () => ({ text: 'unused' }),
    runCrew: async () => ({ kind: 'done', output: 'unused' }),
    runWorkflow: async () => ({ kind: 'done', output: 'unused' }),
    ...overrides,
  };
}

const sig: CapabilitySignature = {
  purpose: 'summarize urls',
  tools: [],
  modelTier: '',
  io: '',
  roles: [],
};

describe('withWallClock', () => {
  test('rejects with dry-run timeout when fn never settles', async () => {
    await expect(
      withWallClock(10, () => new Promise<never>(() => {})),
    ).rejects.toThrow('dry-run timeout');
  });

  test('resolves with the fn value when it finishes in time', async () => {
    await expect(withWallClock(1000, async () => 'fast')).resolves.toBe('fast');
  });
});

describe('representativeTask', () => {
  test('is a benign read-only phrasing derived from the purpose', () => {
    const task = representativeTask('summarize urls', sig);
    expect(task).toContain('summarize urls');
    expect(task.toLowerCase()).toContain('read-only');
  });

  test('falls back to the need when purpose is empty', () => {
    const task = representativeTask('route tickets', { ...sig, purpose: '' });
    expect(task).toContain('route tickets');
  });
});

describe('dryRun', () => {
  test('agent text maps to ran with output', async () => {
    const res = await dryRun(
      ArtifactKind.Agent,
      't',
      deps({ runAgent: async () => ({ text: 'ok' }) }),
    );
    expect(res).toEqual({ ran: true, output: 'ok', repairs: 0 });
  });

  test('agent error maps to not-ran with error', async () => {
    const res = await dryRun(
      ArtifactKind.Agent,
      't',
      deps({ runAgent: async () => ({ error: 'boom' }) }),
    );
    expect(res).toEqual({ ran: false, error: 'boom', repairs: 0 });
  });

  test('crew done maps to ran with stringified output', async () => {
    const res = await dryRun(
      ArtifactKind.Crew,
      't',
      deps({ runCrew: async () => ({ kind: 'done', output: 42 }) }),
    );
    expect(res).toEqual({ ran: true, output: '42', repairs: 0 });
  });

  test('crew failed maps to not-ran with the message', async () => {
    const res = await dryRun(
      ArtifactKind.Crew,
      't',
      deps({ runCrew: async () => ({ kind: 'failed', message: 'x' }) }),
    );
    expect(res).toEqual({ ran: false, error: 'x', repairs: 0 });
  });

  test('workflow non-done without message falls back to the kind', async () => {
    const res = await dryRun(
      ArtifactKind.Workflow,
      't',
      deps({ runWorkflow: async () => ({ kind: 'unverified' }) }),
    );
    expect(res).toEqual({ ran: false, error: 'unverified', repairs: 0 });
  });

  test('a throwing runner maps to not-ran with the stringified error', async () => {
    const res = await dryRun(
      ArtifactKind.Agent,
      't',
      deps({
        runAgent: async () => {
          throw new Error('crashed');
        },
      }),
    );
    expect(res.ran).toBe(false);
    expect(res.error).toContain('crashed');
    expect(res.repairs).toBe(0);
  });
});
