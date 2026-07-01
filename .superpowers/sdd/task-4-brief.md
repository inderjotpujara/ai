## Task 4: Claim decomposition + citation parsing

**Files:** Create `src/verification/claims.ts`; Test `tests/verification/claims.test.ts`

**Interfaces:** Produces `parseCitations(text: string): string[]` (regex `\[mem:([^\]]+)\]`, deduped) and `decomposeClaims(answer: string, deps: VerifyDeps): Promise<Claim[]>` (uses `deps.generate(deps.generalModel, prompt)` → parse a JSON array of `{text, citedIds}`; robust to fenced JSON).

- [ ] **Step 1: Failing test** (mock `generate`)
```ts
// tests/verification/claims.test.ts
import { describe, expect, test } from 'bun:test';
import { parseCitations, decomposeClaims } from '../../src/verification/claims.ts';

describe('citations + claims', () => {
  test('parseCitations extracts + dedupes [mem:id]', () => {
    expect(parseCitations('x [mem:a#0] y [mem:b#1] z [mem:a#0]')).toEqual(['a#0','b#1']);
    expect(parseCitations('no cites')).toEqual([]);
  });
  test('decomposeClaims parses model JSON', async () => {
    const deps: any = { generalModel: 'm', generate: async () => '```json\n[{"text":"The sky is blue","citedIds":["a#0"]},{"text":"Grass is green","citedIds":[]}]\n```' };
    const claims = await decomposeClaims('...', deps);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({ text: 'The sky is blue', citedIds: ['a#0'] });
    expect(claims[1]?.citedIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/claims.ts`**
```ts
import type { Claim, VerifyDeps } from './types.ts';

export function parseCitations(text: string): string[] {
  const out: string[] = [];
  const re = /\[mem:([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) { const id = m[1]!.trim(); if (!out.includes(id)) out.push(id); }
  return out;
}

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1]! : raw).trim();
  const start = body.indexOf('['); const end = body.lastIndexOf(']');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export async function decomposeClaims(answer: string, deps: VerifyDeps): Promise<Claim[]> {
  const prompt = `Break the ANSWER into atomic factual claims. For each claim, list the memory citation ids it cites, taken ONLY from [mem:<id>] tags that appear with that claim. Return a JSON array of {"text": string, "citedIds": string[]}. No prose.\n\nANSWER:\n${answer}`;
  const raw = await deps.generate(deps.generalModel, prompt);
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(raw)); } catch { return [{ text: answer, citedIds: parseCitations(answer) }]; }
  if (!Array.isArray(parsed)) return [{ text: answer, citedIds: parseCitations(answer) }];
  return parsed
    .filter((c): c is { text: string; citedIds?: string[] } => !!c && typeof (c as any).text === 'string')
    .map((c) => ({ text: c.text, citedIds: Array.isArray(c.citedIds) ? c.citedIds.map(String) : [] }));
}
```
> Fallback (unparseable model output → treat the whole answer as one claim) keeps the primitive robust; it's covered by the "returns something" path, not a placeholder.

- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): claim decomposition + [mem:id] citation parsing"`

---

