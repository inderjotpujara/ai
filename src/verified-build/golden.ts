import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { BuilderModel } from '../agent-builder/types.ts';
import { atomicWrite } from '../agent-builder/write.ts';
import type { CapabilitySignature, GoldenCase, GoldenSet } from './types.ts';
import { GoldenKind } from './types.ts';

const MAX_CASES = 7;

const goldenSchema = z.object({
  cases: z
    .array(
      z.object({
        input: z.string(),
        assert: z.string(),
        kind: z.nativeEnum(GoldenKind),
      }),
    )
    .min(1),
});

/** Generate 3–7 golden cases for a need via the structured-generation seam. */
export async function generateGolden(
  need: string,
  sig: CapabilitySignature,
  model: BuilderModel,
): Promise<GoldenSet> {
  const prompt = [
    'Generate 3 to 7 golden test cases for an artifact with this capability.',
    `Need: ${need}`,
    `Purpose: ${sig.purpose}`,
    `Tools: ${sig.tools.join(', ') || 'none'}`,
    `IO: ${sig.io}`,
    'Each case has: input (a concrete task), assert (a checkable requirement',
    `on the output), kind (one of: ${Object.values(GoldenKind).join(', ')}).`,
  ].join('\n');
  const out = await model.object({ schema: goldenSchema, prompt });
  const cases: GoldenCase[] = out.cases.slice(0, MAX_CASES).map((c, i) => ({
    id: `c${i}`,
    input: c.input,
    assert: c.assert,
    kind: c.kind,
  }));
  return { need, cases };
}

export function goldenPathFor(dir: string, name: string): string {
  return `${dir}/${name}.golden.json`;
}

export function loadGolden(path: string): GoldenSet | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoldenSet;
  } catch {
    return null;
  }
}

export function appendGolden(path: string, c: GoldenCase): void {
  const set = loadGolden(path) ?? { need: '', cases: [] };
  set.cases.push(c);
  atomicWrite(path, `${JSON.stringify(set, null, 2)}\n`);
}
