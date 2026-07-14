import { describe, expect, test } from 'bun:test';
import { StatusEventType } from '../../src/contracts/enums.ts';
import type { StatusEvent } from '../../src/contracts/index.ts';
import { createConsentRegistry } from '../../src/server/consent/registry.ts';
import { handleRespond } from '../../src/server/consent/respond.ts';

describe('createConsentRegistry', () => {
  test('port mints an unguessable promptId, emits data-confirm, and returns a pending promise', async () => {
    const registry = createConsentRegistry();
    const emitted: StatusEvent[] = [];
    let settled: unknown;
    let isSettled = false;

    const answer = registry
      .port({ kind: 'mcp-mount', question: 'Approve X?' }, (e) => {
        emitted.push(e);
      })
      .then((value) => {
        isSettled = true;
        settled = value;
        return value;
      });

    // Not yet settled: give the microtask queue a chance to run, in case a
    // bug settled it synchronously.
    await Promise.resolve();
    expect(isSettled).toBe(false);

    expect(emitted).toHaveLength(1);
    const event = emitted[0];
    expect(event?.type).toBe(StatusEventType.Confirm);
    expect(event && 'kind' in event ? event.kind : undefined).toBe('mcp-mount');
    expect(event && 'question' in event ? event.question : undefined).toBe(
      'Approve X?',
    );
    const maybePromptId =
      event && 'promptId' in event ? event.promptId : undefined;
    if (typeof maybePromptId !== 'string') {
      throw new Error('expected the emitted event to carry a promptId');
    }
    const promptId = maybePromptId;
    expect(promptId).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex

    expect(registry.pending()).toEqual([promptId]);

    const first = registry.resolve(promptId, true);
    expect(first).toBe(true);
    expect(await answer).toBe(true);
    expect(settled).toBe(true);
    expect(registry.pending()).toEqual([]);

    const unknown = registry.resolve('nope', true);
    expect(unknown).toBe(false);

    // Second resolve of the same (already-settled) id is a no-op.
    const second = registry.resolve(promptId, false);
    expect(second).toBe(false);
    expect(settled).toBe(true); // unchanged
  });
});

describe('handleRespond', () => {
  function post(body: unknown): Request {
    return new Request('http://localhost/api/runs/run-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('valid respond for a pending prompt settles it and returns 200', async () => {
    const consent = createConsentRegistry();
    let capturedPromptId: string | undefined;
    const answer = consent.port({ kind: 'provision', question: 'ok?' }, (e) => {
      if ('promptId' in e) capturedPromptId = e.promptId;
    });
    expect(capturedPromptId).toBeDefined();

    const req = post({ promptId: capturedPromptId, value: 'yes' });
    const deps = { consent } as unknown as Parameters<typeof handleRespond>[1];
    const res = await handleRespond(req, deps, 'run-1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await answer).toBe('yes');
  });

  test('a body missing promptId (Zod fail) returns 400', async () => {
    const consent = createConsentRegistry();
    const deps = { consent } as unknown as Parameters<typeof handleRespond>[1];
    const req = post({ value: 'yes' });
    const res = await handleRespond(req, deps, 'run-1');
    expect(res.status).toBe(400);
  });

  test('non-JSON body returns 400', async () => {
    const consent = createConsentRegistry();
    const deps = { consent } as unknown as Parameters<typeof handleRespond>[1];
    const req = new Request('http://localhost/api/runs/run-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    });
    const res = await handleRespond(req, deps, 'run-1');
    expect(res.status).toBe(400);
  });

  test('an unknown promptId returns 404', async () => {
    const consent = createConsentRegistry();
    const deps = { consent } as unknown as Parameters<typeof handleRespond>[1];
    const req = post({ promptId: 'does-not-exist', value: true });
    const res = await handleRespond(req, deps, 'run-1');
    expect(res.status).toBe(404);
  });
});

describe('route regex', () => {
  test('matches /api/runs/:id/respond and captures the id', () => {
    const routeRegex = /^\/api\/runs\/([^/]+)\/respond$/;
    const match = '/api/runs/abc/respond'.match(routeRegex);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('abc');

    expect('/api/runs/abc/other'.match(routeRegex)).toBeNull();
    expect('/api/runs//respond'.match(routeRegex)).toBeNull();
  });
});
