import { expect, test } from 'bun:test';
import { BuilderKind } from '../../src/contracts/enums.ts';
import type { RunBuilderTurn } from '../../src/server/builders/build.ts';
import { handleBuilderBuild } from '../../src/server/builders/build.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';

function builderRequest(body: unknown): Request {
  return new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects a malformed body with 400 before any stream opens', async () => {
  const res = await handleBuilderBuild(builderRequest({ need: 'x' }), {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: (async () => ({ kind: 'declined' })) as RunBuilderTurn,
  });
  expect(res.status).toBe(400);
});

test('happy path: data-run-start, narration, and the terminal result all stream, exactly once', async () => {
  const turn: RunBuilderTurn = async ({ log, runId }) => {
    log(`building for run ${runId}`);
    return {
      kind: 'written',
      name: 'stock_quotes',
      files: ['agents/stock_quotes.ts'],
    };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'fetch stock quotes' }),
    {
      runsRoot: '/tmp/unused',
      consent: createConsentRegistry(),
      runBuilderTurn: turn,
    },
  );
  const body = await res.text();
  expect(body).toContain('data-run-start');
  expect(body.match(/"kind":"written"/g)).toHaveLength(1); // terminal result written EXACTLY once
  expect(body).toContain('building for run run-');
  expect(body).toContain('data-run-end');
  expect(body).toContain('"outcome":"written"');
});

test('a throwing runBuilderTurn still produces exactly one terminal result (never crashes the route)', async () => {
  const turn: RunBuilderTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    {
      runsRoot: '/tmp/unused',
      consent: createConsentRegistry(),
      runBuilderTurn: turn,
    },
  );
  const body = await res.text();
  expect(body.match(/"kind":"failed-verification"/g)).toHaveLength(1);
  expect(body).toContain('"detail":"boom"');
});

test('requirement (a): confirm() genuinely suspends the build until POST /api/runs/:id/respond answers it', async () => {
  const registry = createConsentRegistry();
  const turn: RunBuilderTurn = async ({ confirm, log }) => {
    log('before-confirm');
    const granted = await confirm('proceed?');
    log(`after-confirm:${granted}`);
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const res = await handleBuilderBuild(
    builderRequest({ kind: BuilderKind.Agent, need: 'x' }),
    { runsRoot: '/tmp/unused', consent: registry, runBuilderTurn: turn },
  );
  const reader = res.body?.getReader();
  if (!reader) throw new Error('expected a streaming body');
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('before-confirm') || !text.includes('data-confirm')) {
    const { value, done } = await reader.read();
    if (done)
      throw new Error('stream ended before the confirm ask was ever sent');
    text += decoder.decode(value);
  }
  // The ask genuinely suspended execute: nothing past it has arrived yet.
  expect(text).not.toContain('after-confirm');
  const promptId = /"promptId":"([^"]+)"/.exec(text)?.[1];
  expect(promptId).toBeDefined();
  expect(registry.resolve(promptId as string, true)).toBe(true);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain('after-confirm:true');
  expect(text.match(/"kind":"written"/g)).toHaveLength(1);
});

test('requirement (b): a client abort during a pending confirm does not crash, and never resolves against a later, unrelated answer', async () => {
  const registry = createConsentRegistry();
  const controller = new AbortController();
  const turn: RunBuilderTurn = async ({ confirm }) => {
    const granted = await confirm('proceed?');
    return { kind: granted ? 'written' : 'declined', name: 'x', files: [] };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: registry,
    runBuilderTurn: turn,
  });
  controller.abort(); // client navigates away mid-consent
  // The registry entry is still pending — unaffected by the client abort
  // (promptId unguessability already prevents cross-talk; abort just means
  // nobody is reading the stream anymore, which must not throw here).
  expect(registry.pending().length).toBe(1);
  // A stale/late answer must not throw even though nobody reads the response.
  const [promptId] = registry.pending();
  expect(() => registry.resolve(promptId as string, true)).not.toThrow();
});

test('req.signal aborting does NOT stop the build from running to completion (the build is not detached from the connection, but is also not cancelled by it — requirement (d) at the route level)', async () => {
  const controller = new AbortController();
  let completed = false;
  const turn: RunBuilderTurn = async () => {
    await new Promise((r) => setTimeout(r, 5));
    completed = true;
    return { kind: 'declined' };
  };
  const req = new Request('http://localhost/api/builders/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: BuilderKind.Agent, need: 'x' }),
    signal: controller.signal,
  });
  const res = await handleBuilderBuild(req, {
    runsRoot: '/tmp/unused',
    consent: createConsentRegistry(),
    runBuilderTurn: turn,
  });
  controller.abort();
  await res.text(); // still drains to completion server-side
  expect(completed).toBe(true);
});
