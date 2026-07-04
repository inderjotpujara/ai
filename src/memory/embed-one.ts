/** Embed a single text through a batch embed function, returning its one vector. */
export async function embedOne(
  text: string,
  embed: (t: string[]) => Promise<number[][]>,
): Promise<number[]> {
  const vectors = await embed([text]);
  const first = vectors[0];
  if (first === undefined) {
    throw new Error('embedOne: embed returned no vectors for a single text');
  }
  return first;
}

export { cosine } from './chunk.ts';
