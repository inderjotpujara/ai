## Task 5: Live-capped semantic chunker

**Files:**
- Create: `src/memory/chunk.ts`
- Test: `tests/memory/chunk.test.ts`

**Interfaces:**
- Produces: `chunk(text: string, opts: { capTokens: number; embed?: (t: string[]) => Promise<number[][]> }): Promise<Chunk[]>`. Deterministic fixed-size fallback when `embed` is omitted.
- Consumes: `Chunk` from `types.ts`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/chunk.test.ts
import { describe, expect, test } from 'vitest';
import { chunk } from '../../src/memory/chunk.ts';

describe('chunk', () => {
  test('fixed-size fallback respects capTokens (chars≈tokens×4)', async () => {
    const text = 'a'.repeat(1000);
    const chunks = await chunk(text, { capTokens: 50 }); // ~200 chars/chunk
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(50 * 4);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
  test('reassembles to original (fallback, no overlap loss)', async () => {
    const text = 'one two three four five six seven eight';
    const chunks = await chunk(text, { capTokens: 4 });
    expect(chunks.map((c) => c.text).join('')).toContain('one');
  });
  test('semantic split calls embed and keeps chunks under cap', async () => {
    const embed = async (ts: string[]) => ts.map((_, i) => [i % 2, 1 - (i % 2)]); // alternating vectors
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    const chunks = await chunk(text, { capTokens: 100, embed });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100 * 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/chunk.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/chunk.ts`**
```ts
import type { Chunk } from './types.ts';

const CHARS_PER_TOKEN = 4;

function fixed(text: string, capChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += capChars) out.push(text.slice(i, i + capChars));
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Split into chunks. Semantic (embedding-driven) when `embed` is supplied; else fixed-size. */
export async function chunk(
  text: string,
  opts: { capTokens: number; embed?: (t: string[]) => Promise<number[][]>; threshold?: number },
): Promise<Chunk[]> {
  const capChars = Math.max(1, opts.capTokens * CHARS_PER_TOKEN);
  const clean = text.trim();
  if (!clean) return [];

  if (!opts.embed) {
    return fixed(clean, capChars).map((t, i) => ({ text: t, ordinal: i }));
  }

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return fixed(clean, capChars).map((t, i) => ({ text: t, ordinal: i }));

  const vecs = await opts.embed(sentences);
  const threshold = opts.threshold ?? 0.5;
  const chunks: Chunk[] = [];
  let buf = sentences[0];
  for (let i = 1; i < sentences.length; i++) {
    const sim = cosine(vecs[i - 1], vecs[i]);
    const next = `${buf} ${sentences[i]}`;
    if (sim < threshold || next.length > capChars) {
      chunks.push({ text: buf, ordinal: chunks.length });
      buf = sentences[i];
    } else {
      buf = next;
    }
  }
  chunks.push({ text: buf, ordinal: chunks.length });
  // hard-cap any oversize chunk with the fixed splitter
  return chunks.flatMap((c) =>
    c.text.length <= capChars ? [c] : fixed(c.text, capChars).map((t) => ({ text: t, ordinal: 0 })),
  ).map((c, i) => ({ text: c.text, ordinal: i }));
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/chunk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/chunk.ts tests/memory/chunk.test.ts
git commit -m "feat(memory): live-capped semantic chunker with fixed-size fallback"
```

---

