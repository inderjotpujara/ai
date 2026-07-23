import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VerifiedLevel } from '../../src/contracts/enums.ts';
import type { EvalHealthListResponse } from '../../src/contracts/evals.ts';
import { RuntimeKind } from '../../src/core/types.ts';
import type { JobRecord } from '../../src/queue/types.ts';
import { JobKind } from '../../src/queue/types.ts';
import type { EvalHistoryRow } from '../../src/self-improve/history.ts';
import { createEvalHistoryStore } from '../../src/self-improve/history.ts';
import {
  handleEvalHealth,
  mapToEvalHealthDto,
} from '../../src/server/evals/health.ts';
import { handleEvalHistory } from '../../src/server/evals/history.ts';
import { handleEvalReeval } from '../../src/server/evals/reeval.ts';
import type { SessionGuard } from '../../src/server/security/token.ts';
import { upsertEntry } from '../../src/verified-build/manifest.ts';
import type { ManifestEntry } from '../../src/verified-build/types.ts';

const policy = { port: 4130, allowedOrigins: [], allowedHosts: [] };

function guardWith(principal: string | undefined): SessionGuard {
  return {
    verify: () => true,
    verifyToken: () => true,
    principal: () => principal,
  };
}

const localReq = () =>
  new Request('http://127.0.0.1:4130/api/evals/reeval', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'artifact', ref: 'weather-agent' }),
  });

function makeRegistryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evals-registry-'));
  return dir;
}

function seedArtifact(
  dir: string,
  name: string,
  entry: Partial<ManifestEntry> = {},
): void {
  writeFileSync(join(dir, `${name}.ts`), '// generated artifact stub\n');
  const full: ManifestEntry = {
    need: 'weather lookups',
    signature: {
      purpose: 'weather',
      tools: [],
      modelTier: '',
      io: '',
      roles: [],
    },
    vector: [],
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: join(dir, `${name}.golden.json`),
    createdAtMs: Date.now(),
    lastUsedMs: Date.now(),
    useCount: 1,
    lastEvalPass: true,
    ...entry,
  };
  upsertEntry(dir, name, full);
}

function historyStore() {
  return createEvalHistoryStore({
    path: mkdtempSync(join(tmpdir(), 'evals-hist-')),
  });
}

function row(overrides: Partial<EvalHistoryRow> = {}): EvalHistoryRow {
  return {
    id: `row-${Math.random()}`,
    artifactId: 'weather-agent',
    model: 'qwen3:8b',
    ts: Date.now(),
    passed: true,
    passedCount: 3,
    total: 3,
    regressed: false,
    perCase: [{ id: 'c1', passed: true, detail: 'ok' }],
    judgeModel: 'qwen3:8b',
    belowBar: false,
    ...overrides,
  };
}

test('mapToEvalHealthDto: no eval yet → baseline from verifiedWith, currentModel/latest absent, regressed false', () => {
  const entry: ManifestEntry = {
    need: 'weather lookups',
    signature: {
      purpose: 'weather',
      tools: [],
      modelTier: '',
      io: '',
      roles: [],
    },
    vector: [],
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: '/tmp/x.golden.json',
    createdAtMs: 1,
    lastUsedMs: 1,
    useCount: 0,
    lastEvalPass: true,
    verifiedWith: {
      runtime: RuntimeKind.Ollama,
      model: 'qwen3:8b',
      paramsBillions: 8,
      numCtx: 8192,
      capturedAtMs: 1,
    },
  };
  const dto = mapToEvalHealthDto({
    artifact: 'weather-agent',
    entry,
    latest: undefined,
    thumbsDown: 0,
  });
  expect(dto).toEqual({
    artifact: 'weather-agent',
    verifiedLevel: VerifiedLevel.Behaves,
    baselineModel: 'qwen3:8b',
    currentModel: undefined,
    latest: undefined,
    regressed: false,
    thumbsDown: 0,
  });
});

test('mapToEvalHealthDto: a regressed latest row flags regressed + surfaces currentModel from the row', () => {
  const entry: ManifestEntry = {
    need: 'weather lookups',
    signature: {
      purpose: 'weather',
      tools: [],
      modelTier: '',
      io: '',
      roles: [],
    },
    vector: [],
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: '/tmp/x.golden.json',
    createdAtMs: 1,
    lastUsedMs: 1,
    useCount: 0,
    lastEvalPass: false,
    verifiedWith: {
      runtime: RuntimeKind.Ollama,
      model: 'qwen3:8b',
      paramsBillions: 8,
      numCtx: 8192,
      capturedAtMs: 1,
    },
  };
  const latest = row({
    model: 'llama3:8b',
    regressed: true,
    passed: false,
    passedCount: 1,
  });
  const dto = mapToEvalHealthDto({
    artifact: 'weather-agent',
    entry,
    latest,
    thumbsDown: 2,
  });
  expect(dto.regressed).toBe(true);
  expect(dto.currentModel).toBe('llama3:8b');
  expect(dto.baselineModel).toBe('qwen3:8b');
  expect(dto.thumbsDown).toBe(2);
  expect(dto.latest?.id).toBe(latest.id);
});

test('GET /api/evals returns per-artifact health rollups (regressed flagged, thumbsDown present-or-0)', async () => {
  const dir = makeRegistryDir();
  seedArtifact(dir, 'weather-agent');
  seedArtifact(dir, 'never-evaled-agent');
  const history = historyStore();
  history.insert(
    row({ artifactId: 'weather-agent', regressed: true, passed: false }),
  );

  const res = await handleEvalHealth({
    history,
    registryDirs: [dir],
    runsRoot: mkdtempSync(join(tmpdir(), 'evals-runs-')),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as EvalHealthListResponse;
  expect(body.items).toHaveLength(2);
  const weather = body.items.find((i) => i.artifact === 'weather-agent');
  expect(weather?.regressed).toBe(true);
  expect(weather?.thumbsDown).toBe(0);
  const fresh = body.items.find((i) => i.artifact === 'never-evaled-agent');
  expect(fresh?.latest).toBeUndefined();
  expect(fresh?.regressed).toBe(false);
  history.close();
});

test('GET /api/evals degrades to an empty list on a fresh install (no manifest, no history rows)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-empty-'));
  const history = historyStore();
  const res = await handleEvalHealth({
    history,
    registryDirs: [dir],
    runsRoot: mkdtempSync(join(tmpdir(), 'evals-runs-')),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ items: [] });
  history.close();
});

test('GET /api/evals/:artifact returns the full history newest-first', () => {
  const dir = makeRegistryDir();
  seedArtifact(dir, 'weather-agent');
  const history = historyStore();
  const older = row({ artifactId: 'weather-agent', ts: 1000 });
  const newer = row({ artifactId: 'weather-agent', ts: 2000 });
  history.insert(older);
  history.insert(newer);

  const res = handleEvalHistory('weather-agent', {
    history,
    registryDirs: [dir],
  });
  expect(res.status).toBe(200);
  history.close();
});

test('GET /api/evals/:artifact rejects a traversal-y artifact name with 404', () => {
  const dir = makeRegistryDir();
  seedArtifact(dir, 'weather-agent');
  const history = historyStore();
  const res = handleEvalHistory('../../etc/passwd', {
    history,
    registryDirs: [dir],
  });
  expect(res.status).toBe(404);
  history.close();
});

test('GET /api/evals/:artifact 404s for an unknown (but non-traversal) artifact name', () => {
  const dir = makeRegistryDir();
  const history = historyStore();
  const res = handleEvalHistory('no-such-agent', {
    history,
    registryDirs: [dir],
  });
  expect(res.status).toBe(404);
  history.close();
});

test('POST /api/evals/reeval is gated by requireTrustedLocal (403 for a non-local principal)', async () => {
  const calls: unknown[] = [];
  const jobStore = {
    enqueue: (input: unknown) => {
      calls.push(input);
      return { id: 'job-1' } as JobRecord;
    },
  };
  const res = await handleEvalReeval(
    localReq(),
    { jobStore, policy },
    guardWith('550e8400-e29b-41d4-a716-446655440000'),
  );
  expect(res.status).toBe(403);
  expect(calls).toHaveLength(0);
});

test('POST /api/evals/reeval {mode:artifact,ref} enqueues one Eval job with the ref', async () => {
  const calls: unknown[] = [];
  const jobStore = {
    enqueue: (input: unknown) => {
      calls.push(input);
      return { id: 'job-1' } as JobRecord;
    },
  };
  const res = await handleEvalReeval(
    localReq(),
    { jobStore, policy },
    guardWith('local'),
  );
  expect(res.status).toBe(202);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    kind: JobKind.Eval,
    payload: { mode: 'artifact', ref: 'weather-agent', reason: 'manual' },
  });
  const body = await res.json();
  expect(body).toEqual({ enqueued: 1, jobIds: ['job-1'] });
});

test('POST /api/evals/reeval {mode:all} enqueues one Sweep job with no ref', async () => {
  const calls: unknown[] = [];
  const jobStore = {
    enqueue: (input: unknown) => {
      calls.push(input);
      return { id: 'job-2' } as JobRecord;
    },
  };
  const req = new Request('http://127.0.0.1:4130/api/evals/reeval', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'all' }),
  });
  const res = await handleEvalReeval(
    req,
    { jobStore, policy },
    guardWith('local'),
  );
  expect(res.status).toBe(202);
  expect(calls[0]).toMatchObject({
    kind: JobKind.Eval,
    payload: { mode: 'sweep', reason: 'manual' },
  });
});

test('POST /api/evals/reeval rejects a malformed body with 400 (no enqueue)', async () => {
  const calls: unknown[] = [];
  const jobStore = {
    enqueue: (input: unknown) => {
      calls.push(input);
      return { id: 'job-3' } as JobRecord;
    },
  };
  const req = new Request('http://127.0.0.1:4130/api/evals/reeval', {
    method: 'POST',
    headers: { host: '127.0.0.1:4130', 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'artifact' }), // missing required ref
  });
  const res = await handleEvalReeval(
    req,
    { jobStore, policy },
    guardWith('local'),
  );
  expect(res.status).toBe(400);
  expect(calls).toHaveLength(0);
});
