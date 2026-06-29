import { expect, mock, test } from 'bun:test';
import { ResourceError } from '../../src/core/errors.ts';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  ProviderKind,
} from '../../src/core/types.ts';
import { resolveModel } from '../../src/resource/selector.ts';

function m(model: string, b: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 8192 },
    role: 'test',
    capabilities: [Capability.Tools],
    footprint: { approxParamsBillions: b, bytesPerWeight: 0.56 },
  };
}

const reg = [m('big', 9), m('small', 4)];
const req = {
  role: 'r',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
};

test('returns the largest model when it fits', async () => {
  const ensureReady = mock(async () => 8192);
  const { decl, numCtx } = await resolveModel(req, reg, { ensureReady });
  expect(decl.model).toBe('big');
  expect(numCtx).toBe(8192);
  expect(ensureReady).toHaveBeenCalledTimes(1);
});

test('falls back to the next candidate when the largest cannot fit', async () => {
  const ensureReady = mock(async (d: ModelDeclaration) => {
    if (d.model === 'big') throw new ResourceError('no fit');
    return 4096;
  });
  const { decl } = await resolveModel(req, reg, { ensureReady });
  expect(decl.model).toBe('small');
  expect(ensureReady).toHaveBeenCalledTimes(2);
});

test('throws ResourceError when nothing fits', async () => {
  const ensureReady = mock(async () => {
    throw new ResourceError('no fit');
  });
  await expect(resolveModel(req, reg, { ensureReady })).rejects.toBeInstanceOf(
    ResourceError,
  );
});

test('non-resource errors propagate immediately', async () => {
  const ensureReady = mock(async () => {
    throw new TypeError('boom');
  });
  await expect(resolveModel(req, reg, { ensureReady })).rejects.toBeInstanceOf(
    TypeError,
  );
});

test('passes the resident set to the ranker and calls onAttempt', async () => {
  const ensureReady = mock(async () => 8192);
  const listLoaded = mock(async () => [{ name: 'big', sizeBytes: 1 }]);
  const seen: string[] = [];
  await resolveModel(req, reg, {
    ensureReady,
    listLoaded,
    onAttempt: (d) => {
      seen.push(d.model);
    },
  });
  expect(listLoaded).toHaveBeenCalledTimes(1);
  expect(seen[0]).toBe('big');
});
