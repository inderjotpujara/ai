import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { handleWebhook } from '../../src/server/hooks/webhook.ts';
import type { FireContext, FireResult } from '../../src/triggers/fire.ts';
import {
  type Trigger,
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';
import { hashToken } from '../../src/triggers/webhook-verify.ts';

const TOKEN = 'tok_1234567890abcdef';
const SECRET = 'b'.repeat(64);

function makeTrigger(over: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trig-1',
    name: 'hook',
    type: TriggerType.Webhook,
    enabled: true,
    target: {
      kind: 'crew' as never,
      payload: { name: 'c', input: '{{webhook.body}}' },
    },
    config: { hmac: false },
    origin: TriggerOrigin.Console,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

type Fired = { trigger: Trigger; ctx: FireContext };

function makeDeps(over: {
  trigger?: Trigger | undefined;
  secret?: string | undefined;
  runLimiter?: { allow(): boolean };
  fireResult?: FireResult;
  maxBodyBytes?: number;
}) {
  const fired: Fired[] = [];
  const trigger = 'trigger' in over ? over.trigger : makeTrigger();
  const deps = {
    triggerStore: {
      getByTokenHash: (h: string) =>
        trigger && h === hashToken(TOKEN) ? trigger : undefined,
    },
    secretStore: {
      get: (_ref: string) => ('secret' in over ? over.secret : SECRET),
    },
    fire: async (t: Trigger, ctx: FireContext): Promise<FireResult> => {
      fired.push({ trigger: t, ctx });
      return over.fireResult ?? { fired: true, jobId: 'job-x', runId: 'run-x' };
    },
    runLimiter: over.runLimiter,
    maxBodyBytes: over.maxBodyBytes,
  };
  return { deps: deps as never, fired };
}

function sign(ts: string, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

test('unknown token → 404, no fire (no trigger leak)', async () => {
  const { deps, fired } = makeDeps({ trigger: undefined });
  const res = await handleWebhook(
    'nope',
    new Request('http://x/hooks/nope', {
      method: 'POST',
      body: 'hi',
    }),
    deps,
  );
  expect(res.status).toBe(404);
  expect(fired).toHaveLength(0);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe('not found');
});

test('non-webhook / disabled trigger → 404', async () => {
  const disabled = makeDeps({ trigger: makeTrigger({ enabled: false }) });
  const r1 = await handleWebhook(
    TOKEN,
    new Request('http://x', { method: 'POST', body: 'x' }),
    disabled.deps,
  );
  expect(r1.status).toBe(404);
  expect(disabled.fired).toHaveLength(0);

  const wrongType = makeDeps({
    trigger: makeTrigger({ type: TriggerType.Cron }),
  });
  const r2 = await handleWebhook(
    TOKEN,
    new Request('http://x', { method: 'POST', body: 'x' }),
    wrongType.deps,
  );
  expect(r2.status).toBe(404);
});

test('hmac-off trigger fires on the valid token alone → 202 {jobId,runId}, body in {{webhook.body}}', async () => {
  const { deps, fired } = makeDeps({});
  const raw = '{"event":"push"}';
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: raw,
    }),
    deps,
  );
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string; runId: string };
  expect(body).toEqual({ jobId: 'job-x', runId: 'run-x' });
  expect(fired).toHaveLength(1);
  expect(fired[0]?.ctx.reason).toBe('webhook');
  expect(fired[0]?.ctx.vars).toEqual({ 'webhook.body': raw });
});

test('valid HMAC webhook fires the trigger, 202 {jobId,runId}', async () => {
  const { deps, fired } = makeDeps({
    trigger: makeTrigger({ config: { hmac: true }, secretRef: 'ref-1' }),
  });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const raw = '{"event":"push"}';
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: raw,
      headers: {
        'x-agent-timestamp': ts,
        'x-agent-signature': sign(ts, raw),
      },
    }),
    deps,
  );
  expect(res.status).toBe(202);
  expect(fired).toHaveLength(1);
  expect(fired[0]?.ctx.vars).toEqual({ 'webhook.body': raw });
});

test('bad HMAC → 401, no fire', async () => {
  const { deps, fired } = makeDeps({
    trigger: makeTrigger({ config: { hmac: true }, secretRef: 'ref-1' }),
  });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: 'real body',
      headers: {
        'x-agent-timestamp': ts,
        'x-agent-signature': sign(ts, 'forged body'),
      },
    }),
    deps,
  );
  expect(res.status).toBe(401);
  expect(fired).toHaveLength(0);
});

test('replayed/stale timestamp → 409, no fire', async () => {
  const { deps, fired } = makeDeps({
    trigger: makeTrigger({ config: { hmac: true }, secretRef: 'ref-1' }),
  });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000) - 600); // 10 min old
  const raw = 'b';
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: raw,
      headers: { 'x-agent-timestamp': ts, 'x-agent-signature': sign(ts, raw) },
    }),
    deps,
  );
  expect(res.status).toBe(409);
  expect(fired).toHaveLength(0);
});

test('missing HMAC secret → 500, no fire (fail closed)', async () => {
  const { deps, fired } = makeDeps({
    trigger: makeTrigger({ config: { hmac: true }, secretRef: 'ref-1' }),
    secret: undefined,
  });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: 'b',
      headers: { 'x-agent-timestamp': ts, 'x-agent-signature': 'deadbeef' },
    }),
    deps,
  );
  expect(res.status).toBe(500);
  expect(fired).toHaveLength(0);
});

test('rate limiter exhausted → 429, no fire', async () => {
  const { deps, fired } = makeDeps({ runLimiter: { allow: () => false } });
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: 'b',
    }),
    deps,
  );
  expect(res.status).toBe(429);
  expect(fired).toHaveLength(0);
});

test('over-cap Content-Length → 413, no fire (before buffering)', async () => {
  const { deps, fired } = makeDeps({ maxBodyBytes: 1024 });
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: 'b',
      headers: { 'content-length': '99999999999' },
    }),
    deps,
  );
  expect(res.status).toBe(413);
  expect(fired).toHaveLength(0);
});

test('a skipped fire (overlap) still acks 202 with the outcome', async () => {
  const { deps } = makeDeps({
    fireResult: { fired: false, outcome: TriggerOutcome.SkippedOverlap },
  });
  const res = await handleWebhook(
    TOKEN,
    new Request('http://x/hooks/x', {
      method: 'POST',
      body: 'b',
    }),
    deps,
  );
  expect(res.status).toBe(202);
  const body = (await res.json()) as { skipped: string };
  expect(body.skipped).toBe(TriggerOutcome.SkippedOverlap);
});

test('the raw token never appears in any response body', async () => {
  const cases: Response[] = [
    await handleWebhook(
      'unknown',
      new Request('http://x', { method: 'POST', body: 'b' }),
      makeDeps({ trigger: undefined }).deps,
    ),
    await handleWebhook(
      TOKEN,
      new Request('http://x', { method: 'POST', body: 'b' }),
      makeDeps({}).deps,
    ),
  ];
  for (const res of cases) {
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('unknown');
  }
});
