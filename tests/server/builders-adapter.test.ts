import { expect, test } from 'bun:test';
import {
  confirmReuseViaPort,
  confirmViaPort,
  logToTextDelta,
} from '../../src/server/builders/adapter.ts';
import type { ConfirmPort } from '../../src/server/consent/registry.ts';

test('confirmViaPort mints a fixed-kind ask through the port and resolves its answer', async () => {
  const asks: unknown[] = [];
  const port: ConfirmPort = async (ask, emit) => {
    asks.push(ask);
    emit({
      type: 'data-confirm' as never,
      promptId: 'p1',
      kind: ask.kind,
      question: ask.question,
    } as never);
    return true;
  };
  const emitted: unknown[] = [];
  const confirm = confirmViaPort(port, (e) => emitted.push(e), 'build');
  const granted = await confirm('Create this agent?');
  expect(granted).toBe(true);
  expect(asks).toEqual([{ kind: 'build', question: 'Create this agent?' }]);
  expect(emitted).toHaveLength(1);
});

test('confirmViaPort coerces a non-boolean port answer to a boolean', async () => {
  const port: ConfirmPort = async () => undefined;
  const confirm = confirmViaPort(port, () => {}, 'build');
  expect(await confirm('x')).toBe(false);
});

test('confirmReuseViaPort threads the CALLER-supplied kind (varies per call, unlike confirmViaPort)', async () => {
  const seenKinds: string[] = [];
  const port: ConfirmPort = async (ask) => {
    seenKinds.push(ask.kind);
    return ask.kind === 'reuse';
  };
  const confirmReuse = confirmReuseViaPort(port, () => {});
  expect(await confirmReuse('reuse', 'Reuse it?')).toBe(true);
  expect(await confirmReuse('offer', 'Close match — reuse?')).toBe(false);
  expect(seenKinds).toEqual(['reuse', 'offer']);
});

test('logToTextDelta writes one start/delta/end triple per call, with distinct ids', () => {
  const parts: { type: string; id?: string; delta?: string }[] = [];
  const log = logToTextDelta((p) => parts.push(p));
  log('first line');
  log('second line');
  expect(parts).toEqual([
    { type: 'text-start', id: 'narration-0' },
    { type: 'text-delta', id: 'narration-0', delta: 'first line' },
    { type: 'text-end', id: 'narration-0' },
    { type: 'text-start', id: 'narration-1' },
    { type: 'text-delta', id: 'narration-1', delta: 'second line' },
    { type: 'text-end', id: 'narration-1' },
  ]);
});
