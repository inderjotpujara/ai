import { describe, expect, it } from 'bun:test';
import { MemoryKind } from '../../src/memory/types.ts';
import { autoPersistStepOutput } from '../../src/workflow/run-step.ts';

describe('auto-write wiring', () => {
  it('persists a completed step output to namespaced memory unless opted out', async () => {
    const writes: Array<{ t: string; o: Record<string, unknown> }> = [];
    const store = {
      remember: async (t: string, o: Record<string, unknown>) => {
        writes.push({ t, o });
      },
    } as unknown as Parameters<typeof autoPersistStepOutput>[0];
    await autoPersistStepOutput(store, {
      workflowId: 'wf1',
      stepId: 's1',
      output: 'result text',
      persist: true,
      at: 1,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.o.namespace).toBe('wf1');
    expect(writes[0]?.o.space).toBe('default');
    expect(writes[0]?.o.kind).toBe(MemoryKind.RunMemory);
    expect(writes[0]?.o.source).toBe('wf1:s1');
    expect(writes[0]?.t).toBe('result text');
  });

  it('opt-out skips the write', async () => {
    const writes: unknown[] = [];
    const store = {
      remember: async () => {
        writes.push(1);
      },
    } as unknown as Parameters<typeof autoPersistStepOutput>[0];
    await autoPersistStepOutput(store, {
      workflowId: 'wf1',
      stepId: 's1',
      output: 'x',
      persist: false,
      at: 1,
    });
    expect(writes).toHaveLength(0);
  });

  it('skips when no store is provided', async () => {
    await autoPersistStepOutput(undefined, {
      workflowId: 'wf1',
      stepId: 's1',
      output: 'x',
      persist: true,
      at: 1,
    });
    // no throw = pass
  });

  it('skips an empty/whitespace-only output', async () => {
    const writes: unknown[] = [];
    const store = {
      remember: async () => {
        writes.push(1);
      },
    } as unknown as Parameters<typeof autoPersistStepOutput>[0];
    await autoPersistStepOutput(store, {
      workflowId: 'wf1',
      stepId: 's1',
      output: '   ',
      persist: true,
      at: 1,
    });
    expect(writes).toHaveLength(0);
  });

  it('stringifies non-string output', async () => {
    const writes: Array<{ t: string }> = [];
    const store = {
      remember: async (t: string) => {
        writes.push({ t });
      },
    } as unknown as Parameters<typeof autoPersistStepOutput>[0];
    await autoPersistStepOutput(store, {
      workflowId: 'wf1',
      stepId: 's1',
      output: { a: 1 },
      persist: true,
      at: 1,
    });
    expect(writes[0]?.t).toBe(JSON.stringify({ a: 1 }));
  });
});
