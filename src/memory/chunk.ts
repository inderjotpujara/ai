import type { Chunk } from './types.ts';

const CHARS_PER_TOKEN = 4;

function fixed(text: string, capChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += capChars) {
    out.push(text.slice(i, i + capChars));
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av !== undefined && bv !== undefined) {
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Split into chunks. Semantic (embedding-driven) when `embed` is supplied; else fixed-size. */
export async function chunk(
  text: string,
  opts: {
    capTokens: number;
    embed?: (t: string[]) => Promise<number[][]>;
    threshold?: number;
  },
): Promise<Chunk[]> {
  const capChars = Math.max(1, opts.capTokens * CHARS_PER_TOKEN);
  const clean = text.trim();
  if (!clean) return [];

  if (!opts.embed) {
    return fixed(clean, capChars).map((t, i) => ({ text: t, ordinal: i }));
  }

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    return fixed(clean, capChars).map((t, i) => ({ text: t, ordinal: i }));
  }

  const vecs = await opts.embed(sentences);
  if (vecs.length !== sentences.length) {
    throw new Error('chunk: embed returned ' + vecs.length + ' vectors for ' + sentences.length + ' sentences');
  }
  const threshold = opts.threshold ?? 0.5;
  const chunks: Chunk[] = [];
  const firstSentence = sentences[0];
  if (firstSentence === undefined) return [];
  let buf = firstSentence;
  for (let i = 1; i < sentences.length; i++) {
    const prevVec = vecs[i - 1]!;
    const currVec = vecs[i]!;
    const sentence = sentences[i]!;
    const sim = cosine(prevVec, currVec);
    const next = `${buf} ${sentence}`;
    if (sim < threshold || next.length > capChars) {
      chunks.push({ text: buf, ordinal: chunks.length });
      buf = sentence;
    } else {
      buf = next;
    }
  }
  chunks.push({ text: buf, ordinal: chunks.length });
  // hard-cap any oversize chunk with the fixed splitter
  return chunks
    .flatMap((c) =>
      c.text.length <= capChars
        ? [c]
        : fixed(c.text, capChars).map((t) => ({ text: t, ordinal: 0 })),
    )
    .map((c, i) => ({ text: c.text, ordinal: i }));
}
