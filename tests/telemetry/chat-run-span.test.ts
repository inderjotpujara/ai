import { afterEach, expect, test } from 'bun:test';
import {
  ATTR,
  withChatRunSpan,
  withRunSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;
afterEach(async () => {
  await ctx?.provider.shutdown();
});

test('withChatRunSpan opens a chat.run root carrying the run id', async () => {
  ctx = registerTestProvider();
  const out = await withChatRunSpan('run-chat-1', 'hello', async () => 'ok');
  expect(out).toBe('ok');
  const span = ctx.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'chat.run');
  expect(span).toBeDefined();
  expect(span?.attributes[ATTR.RUN_ID]).toBe('run-chat-1');
});

test('withRunSpan STILL opens agent.run — the generic capability is intact (§7.2b)', async () => {
  ctx = registerTestProvider();
  await withRunSpan('run-agent-1', 'task', async () => undefined);
  expect(
    ctx.exporter.getFinishedSpans().some((s) => s.name === 'agent.run'),
  ).toBe(true);
});
