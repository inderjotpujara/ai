import { expect, test } from 'bun:test';
import { builderModelRequirement } from '../../src/agent-builder/deps.ts';
import {
  Capability,
  ContentPolicy,
  type ModelDeclaration,
  PreferPolicy,
  RuntimeKind,
} from '../../src/core/types.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

const decl = (
  model: string,
  params: number,
  contentPolicy?: ContentPolicy,
): ModelDeclaration => ({
  runtime: RuntimeKind.Ollama,
  model,
  params: {},
  role: 'r',
  capabilities: [Capability.Tools],
  contentPolicy,
  footprint: { approxParamsBillions: params, bytesPerWeight: 2 },
});

// I4 — the build-time capture (agent-builder/deps.ts) and the re-eval drift
// resolve (server/launch-turns.ts) MUST use the SAME requirement, or the two
// resolves diverge (uncensored asymmetry) and every artifact shows phantom
// drift. `builderModelRequirement` is that single source of truth.
test('I4: builderModelRequirement omits allowUncensored (uncensored stays filtered)', () => {
  const req = builderModelRequirement();
  expect(req.requires).toEqual([Capability.Tools]);
  expect(req.prefer).toBe(PreferPolicy.LargestThatFits);
  expect(req.allowUncensored).toBeUndefined();
});

test('I4: capture + re-eval resolve pick the SAME model (no phantom drift) under the default uncensored setting', () => {
  // A LARGER uncensored model U alongside the censored model A the build
  // captured. Without allowUncensored, LargestThatFits must skip U and pick A.
  const registry = [
    decl('A:7b', 7),
    decl('U:70b', 70, ContentPolicy.Uncensored),
  ];
  // Build-time capture requirement === re-eval drift requirement (same fn).
  const captureReq = builderModelRequirement();
  const reevalReq = builderModelRequirement('summarize'); // role differs, selection must not
  expect(selectCandidates(captureReq, registry)[0]?.model).toBe('A:7b');
  expect(selectCandidates(reevalReq, registry)[0]?.model).toBe('A:7b');
});
