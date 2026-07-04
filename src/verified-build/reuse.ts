import { cosine, embedOne } from '../memory/embed-one.ts';
import { reuseBands } from './config.ts';
import { readManifest } from './manifest.ts';
import { signatureText } from './signature.ts';
import type { CapabilitySignature, ReuseDecision } from './types.ts';
import { ReuseKind } from './types.ts';

export type ReuseDeps = {
  embed: (t: string[]) => Promise<number[][]>;
  dir: string;
};

/** Decide reuse/offer/generate by cosine similarity against the manifest. */
export async function reuseDecision(
  sig: CapabilitySignature,
  deps: ReuseDeps,
): Promise<ReuseDecision> {
  const vector = await embedOne(signatureText(sig), deps.embed);
  const manifest = readManifest(deps.dir);

  let best: { name: string; similarity: number; useCount: number } | undefined;
  for (const [name, entry] of Object.entries(manifest.entries)) {
    const similarity = cosine(vector, entry.vector);
    const wins =
      best === undefined ||
      similarity > best.similarity ||
      (similarity === best.similarity && entry.useCount > best.useCount);
    if (wins) {
      best = { name, similarity, useCount: entry.useCount };
    }
  }

  if (best === undefined) {
    return { kind: ReuseKind.Generate, similarity: 0 };
  }

  const bands = reuseBands();
  if (best.similarity >= bands.reuse) {
    return {
      kind: ReuseKind.Reuse,
      match: best.name,
      similarity: best.similarity,
    };
  }
  if (best.similarity >= bands.offer) {
    return {
      kind: ReuseKind.Offer,
      match: best.name,
      similarity: best.similarity,
    };
  }
  return {
    kind: ReuseKind.Generate,
    match: best.name,
    similarity: best.similarity,
  };
}
