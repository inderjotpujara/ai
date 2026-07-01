# Slice 13 — Grounded Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verification layer so a crew/workflow answer is checked against its cited evidence before it's presented — a MiniCheck-backed faithfulness + citation judge, a bounded CRAG corrective, and abstention when still ungrounded.

**Architecture:** New `src/verification/` module (pure, dependency-injected) exposing a `verify(answer,{query,space},deps)` primitive: decompose the answer into claims + their `[mem:<id>]` citations → fetch cited chunks via a new `MemoryStore.getByIds` → check each claim against its cited chunk with a small fine-tuned checker (`bespoke-minicheck`, general-model fallback) → aggregate faithfulness. Verification is wired as a crew task / workflow step (opt-in `verify:true` / `--verify`, auto-inserted with a Branch for pass/fail and one bounded CRAG corrective); final failure abstains via a new `{kind:'unverified'}` outcome.

**Tech Stack:** Bun + TypeScript, AI SDK v6 (`generateText`), `ollama-ai-provider-v2`, Ollama (`bespoke-minicheck` judge model, pulled on consent), `@lancedb/lancedb` (getByIds), OpenTelemetry spans, Zod, `bun test`.

## Global Constraints

- **Always `bun`, never `npm`.** `type` over `interface`; `enum` over string-literal unions (string enums only).
- **Early returns; small focused files; descriptive names; no `console.log`** in committed code (CLI user-facing output is fine).
- **Compute live; env vars fallback-only.** Never hardcode model choices/budgets/limits.
- **Default judge = `bespoke-minicheck`** (env `AGENT_VERIFY_MODEL`); **threshold 0.9** (`AGENT_VERIFY_THRESHOLD`, 0<n≤1); **max retries 1** (`AGENT_VERIFY_MAX_RETRIES`); `AGENT_VERIFY_ENABLED`; `AGENT_VERIFY_AUTO_PULL` (unset=prompt, `1`=pull silently, `0`=never pull→fallback).
- **MiniCheck missing → consent-then-pull in an interactive TTY; decline or non-interactive → general-model NLI fallback with a logged notice. Never hard-fail.** Tests always take the fallback/mock path (no network).
- **Evidence = the chunks the answer CITES** (parse `[mem:<id>]`, fetch via `getByIds`). Uncited claim → unsupported. No citations → abstain.
- **An "unsupported" verdict is DATA, not an error.** `VerificationError` is only for misuse (verify without a store).
- **CRAG = one bounded unrolled corrective** (engine has no native loop).
- **No new npm dependency** (MiniCheck is an Ollama pull).
- **Test files import `bun:test`** (NOT `vitest` — it breaks `tsc`). No `any` (use typed rows / scoped `biome-ignore` only if unavoidable).
- **Additive**: crews/workflows WITHOUT `verify` must behave identically (existing tests unchanged).
- **Every task ends green:** `bun run typecheck` + relevant tests pass before commit. Pre-PR gate: `bun run check`.
- **Telemetry:** `verification.check` span + `ATTR.VERIFICATION_*`. **Docs hard line:** architecture.md + README + ROADMAP + Artifact (Task 14).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/errors.ts` (modify) | add `VerificationError` |
| `src/verification/types.ts` (create) | `CragGrade` enum, `Claim`, `ClaimVerdict`, `Verdict`, `VerifyOptions`, `VerifyDeps` |
| `src/verification/config.ts` (create) | env-fallback getters: `verifyModel()`, `verifyThreshold()`, `verifyMaxRetries()`, `verifyEnabled()`, `autoPullPolicy()` |
| `src/verification/claims.ts` (create) | `decomposeClaims(answer, deps)` + `parseCitations(text)` |
| `src/verification/judge.ts` (create) | `ensureJudgeModel`, `checkClaim`, `verifyFaithfulness` |
| `src/verification/crag.ts` (create) | `gradeRetrieval`, `correctiveRetrieve` |
| `src/verification/verify.ts` (create) | `verify(answer, opts, deps)` primitive |
| `src/memory/store.ts` + `lancedb-store.ts` (modify) | `getByIds(space, ids)` |
| `src/telemetry/spans.ts` (modify) | `ATTR.VERIFICATION_*` + `withVerificationSpan` + `recordVerdict` |
| `src/crew/types.ts` + `compile.ts` + `engine.ts` (modify) | `verify?` flag; auto-insert verify→branch→corrective→abstain; `unverified` outcome |
| `src/workflow/types.ts` + `run-step.ts` (modify) | `AgentStep.verify?`; verify step kind or expansion |
| `src/cli/flow.ts` + `crew.ts` (modify) | `--verify` flag; wire real `VerifyDeps`; write `unverified.txt` |
| `tests/verification/*.test.ts`, `tests/verification/golden/*.json`, `tests/integration/verification.live.test.ts` | unit + eval + live |

---

## Task 1: `VerificationError` + types + config

**Files:** Modify `src/core/errors.ts`; Create `src/verification/types.ts`, `src/verification/config.ts`; Test `tests/verification/config.test.ts`

**Interfaces:**
- Produces: `VerificationError`; the types below; `verifyModel()`='bespoke-minicheck', `verifyThreshold()`=0.9, `verifyMaxRetries()`=1, `verifyEnabled()`=bool, `autoPullPolicy(): 'prompt'|'always'|'never'`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/verification/config.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { verifyModel, verifyThreshold, verifyMaxRetries, autoPullPolicy } from '../../src/verification/config.ts';

afterEach(() => {
  for (const k of ['AGENT_VERIFY_MODEL','AGENT_VERIFY_THRESHOLD','AGENT_VERIFY_MAX_RETRIES','AGENT_VERIFY_AUTO_PULL']) delete process.env[k];
});

describe('verification config', () => {
  test('defaults', () => {
    expect(verifyModel()).toBe('bespoke-minicheck');
    expect(verifyThreshold()).toBe(0.9);
    expect(verifyMaxRetries()).toBe(1);
    expect(autoPullPolicy()).toBe('prompt');
  });
  test('env overrides + range guards', () => {
    process.env.AGENT_VERIFY_MODEL='x'; process.env.AGENT_VERIFY_THRESHOLD='0.5';
    process.env.AGENT_VERIFY_MAX_RETRIES='2'; process.env.AGENT_VERIFY_AUTO_PULL='1';
    expect(verifyModel()).toBe('x'); expect(verifyThreshold()).toBe(0.5);
    expect(verifyMaxRetries()).toBe(2); expect(autoPullPolicy()).toBe('always');
  });
  test('out-of-range threshold falls back', () => {
    process.env.AGENT_VERIFY_THRESHOLD='3'; expect(verifyThreshold()).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `bun test tests/verification/config.test.ts` (module not found).

- [ ] **Step 3: Add `VerificationError`**
```ts
// append to src/core/errors.ts
/** Misuse of the verification layer (e.g. verify called without a memory store). */
export class VerificationError extends FrameworkError {}
```

- [ ] **Step 4: Write `src/verification/types.ts`**
```ts
import type { RetrievalResult } from '../memory/types.ts';

export enum CragGrade { Correct = 'correct', Ambiguous = 'ambiguous', Incorrect = 'incorrect' }

export type Claim = { text: string; citedIds: string[] };
export type ClaimVerdict = { claim: string; citedIds: string[]; supported: boolean; reason?: string };
export type Verdict = {
  supported: boolean;
  faithfulness: number;        // 0..1 = supported / total claims
  claims: ClaimVerdict[];
  unsupportedClaims: string[];
  usedFallback: boolean;
};

export type VerifyOptions = { space?: string; threshold?: number };

/** Injected so the primitive stays pure/testable. Real wiring lives in the CLI. */
export type VerifyDeps = {
  /** Run a prompt on a model id, return its text. Real impl routes via the Model Manager. */
  generate: (model: string, prompt: string) => Promise<string>;
  /** Fetch chunk texts by id from the memory store. */
  getByIds: (space: string, ids: string[]) => Promise<RetrievalResult[]>;
  /** Ensure the judge model is available; returns which model to use + whether it's the fallback. */
  ensureJudge: (model: string) => Promise<{ model: string; fallback: boolean }>;
  /** The general/router model id used for decomposition, grading, and fallback judging. */
  generalModel: string;
};
```

- [ ] **Step 5: Write `src/verification/config.ts`** (mirror the `src/memory/budget.ts` env-fallback style)
```ts
export function verifyModel(): string { return process.env.AGENT_VERIFY_MODEL?.trim() || 'bespoke-minicheck'; }
export function verifyThreshold(): number { const r = Number(process.env.AGENT_VERIFY_THRESHOLD); return r > 0 && r <= 1 ? r : 0.9; }
export function verifyMaxRetries(): number { const r = Number(process.env.AGENT_VERIFY_MAX_RETRIES); return Number.isInteger(r) && r >= 0 ? r : 1; }
export function verifyEnabled(): boolean { return process.env.AGENT_VERIFY_ENABLED !== '0'; }
export function autoPullPolicy(): 'prompt' | 'always' | 'never' {
  const v = process.env.AGENT_VERIFY_AUTO_PULL;
  if (v === '1') return 'always'; if (v === '0') return 'never'; return 'prompt';
}
```

- [ ] **Step 6: Run tests + typecheck** — `bun test tests/verification/config.test.ts && bun run typecheck` → PASS.
- [ ] **Step 7: Commit** — `git add src/core/errors.ts src/verification/ tests/verification/config.test.ts && git commit -m "feat(verification): VerificationError, types, config"`

> **Controller note:** after Task 1 creates `src/verification/`, add a short "Verification (Slice 13 — in progress)" stub to `docs/architecture.md` so `docs:check` passes for Tasks 2–13 (mirror the Slice-12 stub convention). Full section lands in Task 14.

---

## Task 2: Telemetry spans (additive)

**Files:** Modify `src/telemetry/spans.ts`; Test `tests/verification/spans.test.ts`

**Interfaces:** Produces `ATTR.VERIFICATION_SUPPORTED/FAITHFULNESS/UNSUPPORTED/CRAG_GRADE/RETRIES/FALLBACK`; `withVerificationSpan(info, fn)`; `recordVerdict(v)`.

> Read `src/telemetry/spans.ts` first; mirror `withMemoryRecallSpan`/`recordGuardrailViolation` exactly (the `inSpan` primitive + `trace.getActiveSpan()` guard pattern).

- [ ] **Step 1: Failing test**
```ts
// tests/verification/spans.test.ts
import { describe, expect, test } from 'bun:test';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { withVerificationSpan } from '../../src/telemetry/spans.ts';

describe('verification span', () => {
  test('emits verification.check with supported + faithfulness', async () => {
    const { exporter, shutdown } = registerTestProvider();
    await withVerificationSpan({ supported: false, faithfulness: 0.5, crag: 'incorrect', retries: 1, fallback: false }, async () => 'x');
    const s = exporter.getFinishedSpans().find((sp) => sp.name === 'verification.check');
    expect(s?.attributes['verification.supported']).toBe(false);
    expect(s?.attributes['verification.faithfulness']).toBe(0.5);
    await shutdown();
  });
});
```
> Adapt the helper import/shape to the real `tests/helpers/otel-test-provider.ts` (see how `tests/**` assert memory/crew spans).

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extend `ATTR` + add helpers** (mirror existing span helpers):
```ts
// add to ATTR:
VERIFICATION_SUPPORTED: 'verification.supported',
VERIFICATION_FAITHFULNESS: 'verification.faithfulness',
VERIFICATION_UNSUPPORTED: 'verification.unsupported_claims',
VERIFICATION_CRAG_GRADE: 'verification.crag_grade',
VERIFICATION_RETRIES: 'verification.retries',
VERIFICATION_FALLBACK: 'verification.fallback',

export function withVerificationSpan<T>(
  info: { supported?: boolean; faithfulness?: number; crag?: string; retries?: number; fallback?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('verification.check', async (span) => {
    if (info.supported != null) span.setAttribute(ATTR.VERIFICATION_SUPPORTED, info.supported);
    if (info.faithfulness != null) span.setAttribute(ATTR.VERIFICATION_FAITHFULNESS, info.faithfulness);
    if (info.crag) span.setAttribute(ATTR.VERIFICATION_CRAG_GRADE, info.crag);
    if (info.retries != null) span.setAttribute(ATTR.VERIFICATION_RETRIES, info.retries);
    if (info.fallback != null) span.setAttribute(ATTR.VERIFICATION_FALLBACK, info.fallback);
    return fn();
  });
}
```
- [ ] **Step 4: Run tests + full suite** — `bun test tests/verification/spans.test.ts && bun test` → PASS, no telemetry regression.
- [ ] **Step 5: Commit** — `git commit -m "feat(telemetry): verification.check span + ATTR.VERIFICATION_*"`

---

## Task 3: `MemoryStore.getByIds`

**Files:** Modify `src/memory/lancedb-store.ts` (add `getByIds`), `src/memory/store.ts` (expose it); Test `tests/memory/getbyids.test.ts`

**Interfaces:** Produces `LanceStore.getByIds(space, ids: string[]): Promise<RetrievalResult[]>` and `MemoryStore.getByIds(space, ids)`.

- [ ] **Step 1: Failing test** (real LanceDB, tiny table — mirror `tests/memory/lancedb-smoke.test.ts`)
```ts
// tests/memory/getbyids.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { LanceStore } from '../../src/memory/lancedb-store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/getbyids-test';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

describe('LanceStore.getByIds', () => {
  test('returns only the requested ids', async () => {
    const s = new LanceStore(DIR);
    await s.openOrCreateTable('default', 2);
    await s.upsert('default', [
      { id: 'a#0', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'alpha', vector: [1,0], source: 'a', createdAt: 1 },
      { id: 'b#0', space: 'default', namespace: '', kind: MemoryKind.Document, text: 'beta', vector: [0,1], source: 'b', createdAt: 1 },
    ]);
    const got = await s.getByIds('default', ['a#0']);
    expect(got.map((r) => r.id)).toEqual(['a#0']);
    expect(got[0]?.text).toBe('alpha');
    expect(await s.getByIds('default', [])).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 2: Run → FAIL** (`getByIds` undefined).
- [ ] **Step 3: Implement `getByIds`** in `src/memory/lancedb-store.ts` (reuse the file's `escapeSqlLiteral` + query pattern used by `hybridSearch`):
```ts
async getByIds(space: string, ids: string[]): Promise<RetrievalResult[]> {
  if (ids.length === 0) return [];
  const db = await this.db();
  const tbl = await db.openTable(space);
  const list = ids.map((i) => `'${escapeSqlLiteral(i)}'`).join(',');
  const rows = (await tbl.query().where(`id IN (${list})`).toArray()) as any[];
  return rows.map((r) => ({ id: r.id, text: r.text, source: r.source, score: 0, namespace: r.namespace }));
}
```
> Confirm the non-vector query API in the installed `@lancedb/lancedb@0.30.0` (`tbl.query().where(...).toArray()`); if the accessor differs, use the version's real filter-query API. Keep the signature stable. Type the row shape if biome flags `any`.

- [ ] **Step 4: Expose on the facade** in `src/memory/store.ts` — add to the returned object: `async getByIds(space: string, ids: string[]) { return lance.getByIds(space, ids); }`

- [ ] **Step 5: Run tests + typecheck + full suite** → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(memory): getByIds(space, ids) for citation-evidence lookup"`

---

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

## Task 5: Judge (MiniCheck check + faithfulness aggregation + consent-pull)

**Files:** Create `src/verification/judge.ts`; Test `tests/verification/judge.test.ts`

**Interfaces:**
- Consumes: `VerifyDeps`, `Claim`, `Verdict`, `ClaimVerdict` (Task 1); `RetrievalResult` (memory).
- Produces: `checkClaim(claim, evidence, judgeModel, deps): Promise<boolean>`; `verifyFaithfulness(claims, evidenceById, judgeModel, fallback, threshold, deps): Promise<Verdict>`; `ensureJudgeModel(deps, ensureFn): Promise<{model,fallback}>` (thin — real consent lives in the CLI dep `deps.ensureJudge`; here just call it).

- [ ] **Step 1: Failing test** (mock `generate`: MiniCheck answers "Yes"/"No")
```ts
// tests/verification/judge.test.ts
import { describe, expect, test } from 'bun:test';
import { checkClaim, verifyFaithfulness } from '../../src/verification/judge.ts';

const yes = { generalModel: 'g', generate: async (_m: string, p: string) => (p.includes('blue') ? 'Yes' : 'No') } as any;

describe('judge', () => {
  test('checkClaim maps Yes/No → boolean', async () => {
    expect(await checkClaim('sky is blue', 'the sky is blue', 'j', yes)).toBe(true);
    expect(await checkClaim('grass is red', 'grass is green', 'j', yes)).toBe(false);
  });
  test('verifyFaithfulness aggregates + thresholds; uncited claim → unsupported', async () => {
    const claims = [
      { text: 'sky is blue', citedIds: ['a#0'] },
      { text: 'grass is red', citedIds: ['b#0'] },
      { text: 'uncited fact', citedIds: [] },
    ];
    const ev = new Map([['a#0','the sky is blue'],['b#0','grass is green']]);
    const v = await verifyFaithfulness(claims, ev, 'j', false, 0.9, yes);
    expect(v.claims.find((c) => c.claim==='sky is blue')?.supported).toBe(true);
    expect(v.claims.find((c) => c.claim==='grass is red')?.supported).toBe(false);
    expect(v.claims.find((c) => c.claim==='uncited fact')?.supported).toBe(false); // no citation → unsupported
    expect(v.faithfulness).toBeCloseTo(1/3, 5);
    expect(v.supported).toBe(false);
    expect(v.unsupportedClaims).toContain('uncited fact');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/judge.ts`**
```ts
import type { Claim, ClaimVerdict, Verdict, VerifyDeps } from './types.ts';

/** MiniCheck-style call: (document, claim) → Yes/No. Fallback uses the same shape on the general model. */
export async function checkClaim(claim: string, evidence: string, judgeModel: string, deps: VerifyDeps): Promise<boolean> {
  if (!evidence.trim()) return false;
  const prompt = `Document:\n${evidence}\n\nClaim: ${claim}\n\nIs the claim fully supported by the document? Answer only "Yes" or "No".`;
  const raw = (await deps.generate(judgeModel, prompt)).trim().toLowerCase();
  return raw.startsWith('yes');
}

export async function verifyFaithfulness(
  claims: Claim[], evidenceById: Map<string, string>, judgeModel: string, fallback: boolean, threshold: number, deps: VerifyDeps,
): Promise<Verdict> {
  const verdicts: ClaimVerdict[] = [];
  for (const c of claims) {
    if (c.citedIds.length === 0) { verdicts.push({ claim: c.text, citedIds: [], supported: false, reason: 'no citation' }); continue; }
    const evidence = c.citedIds.map((id) => evidenceById.get(id) ?? '').filter(Boolean).join('\n\n');
    const supported = await checkClaim(c.text, evidence, judgeModel, deps);
    verdicts.push({ claim: c.text, citedIds: c.citedIds, supported, reason: supported ? undefined : (evidence ? 'unsupported by cited evidence' : 'cited chunk missing') });
  }
  const total = verdicts.length || 1;
  const supportedCount = verdicts.filter((v) => v.supported).length;
  const faithfulness = supportedCount / total;
  return {
    supported: faithfulness >= threshold,
    faithfulness,
    claims: verdicts,
    unsupportedClaims: verdicts.filter((v) => !v.supported).map((v) => v.claim),
    usedFallback: fallback,
  };
}
```
- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): MiniCheck claim check + faithfulness aggregation"`

---

## Task 6: CRAG grader + bounded corrective retrieve

**Files:** Create `src/verification/crag.ts`; Test `tests/verification/crag.test.ts`

**Interfaces:**
- Consumes: `VerifyDeps`, `CragGrade`; `RetrievalResult` + a `recall` fn (injected).
- Produces: `gradeRetrieval(query, chunks, deps): Promise<CragGrade>`; `rewriteQuery(query, deps): Promise<string>`; `correctiveRetrieve(query, recall, deps): Promise<{ query: string; chunks: RetrievalResult[] }>`.

- [ ] **Step 1: Failing test** (mock generate)
```ts
// tests/verification/crag.test.ts
import { describe, expect, test } from 'bun:test';
import { gradeRetrieval, correctiveRetrieve } from '../../src/verification/crag.ts';
import { CragGrade } from '../../src/verification/types.ts';

describe('crag', () => {
  test('gradeRetrieval maps model label → enum', async () => {
    const deps: any = { generate: async () => 'INCORRECT' };
    expect(await gradeRetrieval('q', [], deps)).toBe(CragGrade.Incorrect);
  });
  test('correctiveRetrieve rewrites query + re-recalls once', async () => {
    const deps: any = { generalModel: 'g', generate: async () => 'better query' };
    const recall = async (q: string) => [{ id: 'x#0', text: 'hit for '+q, source: 'x', score: 0, namespace: '' }];
    const out = await correctiveRetrieve('orig', recall, deps);
    expect(out.query).toBe('better query');
    expect(out.chunks[0]?.text).toContain('better query');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/crag.ts`**
```ts
import type { RetrievalResult } from '../memory/types.ts';
import { CragGrade } from './types.ts';
import type { VerifyDeps } from './types.ts';

export async function gradeRetrieval(query: string, chunks: RetrievalResult[], deps: VerifyDeps): Promise<CragGrade> {
  const ctx = chunks.map((c) => c.text).join('\n---\n') || '(no chunks)';
  const prompt = `Query: ${query}\n\nRetrieved context:\n${ctx}\n\nIs this context sufficient and relevant to answer the query? Reply with one word: CORRECT, AMBIGUOUS, or INCORRECT.`;
  const raw = (await deps.generate(deps.generalModel, prompt)).trim().toLowerCase();
  if (raw.startsWith('correct')) return CragGrade.Correct;
  if (raw.startsWith('incorrect')) return CragGrade.Incorrect;
  return CragGrade.Ambiguous;
}

export async function rewriteQuery(query: string, deps: VerifyDeps): Promise<string> {
  const raw = await deps.generate(deps.generalModel, `Rewrite this search query to retrieve better evidence. Return ONLY the rewritten query.\n\n${query}`);
  return raw.trim().split('\n')[0]!.trim() || query;
}

export async function correctiveRetrieve(
  query: string, recall: (q: string) => Promise<RetrievalResult[]>, deps: VerifyDeps,
): Promise<{ query: string; chunks: RetrievalResult[] }> {
  const rewritten = await rewriteQuery(query, deps);
  const chunks = await recall(rewritten);
  return { query: rewritten, chunks };
}
```
- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): CRAG retrieval grader + bounded corrective retrieve"`

---

## Task 7: `verify()` primitive

**Files:** Create `src/verification/verify.ts`; Test `tests/verification/verify.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1/4/5; `withVerificationSpan` (Task 2); `VerificationError`.
- Produces: `verify(answer: string, opts: { query: string; space: string; threshold?: number }, deps: VerifyDeps): Promise<Verdict>`.

- [ ] **Step 1: Failing test** (mock deps end-to-end)
```ts
// tests/verification/verify.test.ts
import { describe, expect, test } from 'bun:test';
import { verify } from '../../src/verification/verify.ts';

function deps(over: Partial<any> = {}): any {
  return {
    generalModel: 'g',
    ensureJudge: async (m: string) => ({ model: m, fallback: false }),
    generate: async (_m: string, p: string) => {
      if (p.includes('atomic factual claims')) return '[{"text":"Raft elects a leader","citedIds":["r#0"]}]';
      return p.includes('Raft') ? 'Yes' : 'No'; // checkClaim
    },
    getByIds: async (_s: string, ids: string[]) => ids.map((id) => ({ id, text: 'Raft elects a leader via timeouts', source: 'kb', score: 0, namespace: '' })),
    ...over,
  };
}

describe('verify', () => {
  test('grounded answer → supported', async () => {
    const v = await verify('Raft elects a leader [mem:r#0]', { query: 'raft leader', space: 'default' }, deps());
    expect(v.supported).toBe(true);
    expect(v.faithfulness).toBe(1);
  });
  test('no citations → abstain-worthy (faithfulness 0)', async () => {
    const d = deps({ generate: async (_m: string, p: string) => (p.includes('atomic') ? '[{"text":"Uncited claim","citedIds":[]}]' : 'No') });
    const v = await verify('Uncited claim', { query: 'q', space: 'default' }, d);
    expect(v.supported).toBe(false);
    expect(v.faithfulness).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/verification/verify.ts`**
```ts
import { withVerificationSpan } from '../telemetry/spans.ts';
import { verifyThreshold } from './config.ts';
import { decomposeClaims } from './claims.ts';
import { verifyFaithfulness } from './judge.ts';
import type { Verdict, VerifyDeps } from './types.ts';

export async function verify(
  answer: string, opts: { query: string; space: string; threshold?: number }, deps: VerifyDeps,
): Promise<Verdict> {
  const threshold = opts.threshold ?? verifyThreshold();
  const claims = await decomposeClaims(answer, deps);
  const allIds = [...new Set(claims.flatMap((c) => c.citedIds))];
  const judge = await deps.ensureJudge(deps.generalModel); // model id resolved by caller; see wiring
  const evidence = allIds.length ? await deps.getByIds(opts.space, allIds) : [];
  const evidenceById = new Map(evidence.map((e) => [e.id, e.text]));
  return withVerificationSpan({}, async () => {
    const verdict: Verdict = await verifyFaithfulness(claims, evidenceById, judge.model, judge.fallback, threshold, deps);
    // annotate the span from the computed verdict
    return verdict;
  });
}
```
> Note: `ensureJudge` here is passed the desired judge model by the CLI wiring (Task 10) — the primitive stays agnostic; tests inject a fake returning `{model, fallback}`. If you prefer, thread the judge model via `opts` — keep it consistent with the wiring task and the test.

- [ ] **Step 4: Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(verification): verify() primitive (decompose→evidence→judge)"`

---

## Task 8: Crew auto-insertion (`verify` flag → verify/branch/corrective/abstain)

**Files:** Modify `src/crew/types.ts` (`Task.verify?`, `CrewDef.verify?`, `CrewOutcome` +`unverified`), `src/crew/compile.ts` (insert steps), `src/crew/engine.ts` (map outcome); Test `tests/crew/verify-wiring.test.ts`

**Interfaces:** Consumes verify primitive + workflow Branch step. Produces the compiled sub-graph + `{kind:'unverified'}` outcome.

> Read `src/crew/compile.ts` + `src/workflow/types.ts` (BranchStep: `predicate`/`whenTrue`/`whenFalse`) first. Keep additive: a task without `verify` compiles exactly as today.

- [ ] **Step 1: Failing test** (mock models via injected deps; assert an unsupported answer yields `unverified`)
```ts
// tests/crew/verify-wiring.test.ts  (sketch — align to runCrew's real deps shape)
import { describe, expect, test } from 'bun:test';
import { runCrew } from '../../src/crew/engine.ts';
// Build a 1-task crew with verify:true, inject a verifyDeps whose judge always says "No"
// → expect outcome.kind === 'unverified' with unsupportedClaims non-empty.
```
> Flesh out against `runCrew`'s real signature; the assertion is: `verify:true` + failing judge → `{kind:'unverified'}`; `verify:true` + passing judge → `{kind:'done'}`; no `verify` → unchanged.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add flags + outcome** to `src/crew/types.ts`:
```ts
// Task<O>: add `verify?: boolean;`
// CrewDef: add `verify?: boolean;` (applies to the final/answer task)
// CrewOutcome union: add:
| { kind: 'unverified'; failedTaskId?: string; unsupportedClaims: string[]; faithfulness: number; draft: string }
```
- [ ] **Step 4: Insert the sub-graph** in `src/crew/compile.ts`: for a task with `verify`, after its AgentStep append a verify step (calls the primitive with the task output + query), a Branch on `supported`, a corrective+re-answer+verify₂ path (bounded by `verifyMaxRetries()`), and an abstain terminal. Map the abstain terminal's result to the `unverified` outcome in `src/crew/engine.ts`.
> This is the largest task; keep the inserted steps small + named (`<taskId>__verify`, `__branch`, `__corrective`, `__verify2`, `__abstain`). Reuse `effectiveTaskDeps`/context threading. If the branch/corrective wiring gets unwieldy, STOP and report DONE_WITH_CONCERNS with the sub-graph shape for review.

- [ ] **Step 5: Run tests + full suite** (existing crew tests unchanged) → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(crew): opt-in verify → branch + bounded CRAG + unverified abstention"`

---

## Task 9: Workflow verify wiring

**Files:** Modify `src/workflow/types.ts` (`AgentStep.verify?`) + `src/workflow/run-step.ts`/`engine.ts` or a `withVerification(step)` helper; Test `tests/workflow/verify-wiring.test.ts`

- [ ] **Step 1–5:** Mirror Task 8 for the workflow path: an `AgentStep.verify?: boolean` (or a `withVerification(step, {space})` helper in `src/workflow`) expands at `defineWorkflow` time to the same verify→branch→corrective→abstain sub-graph. Test: a workflow step with `verify` + failing judge routes to the abstain terminal. Commit `feat(workflow): opt-in verify step expansion`.
> If crew already compiles to a workflow, prefer implementing the expansion ONCE as a shared `src/verification/expand.ts` helper used by both compilers (DRY). Decide in Task 8 and reuse here.

---

## Task 10: CLI `--verify` + real `VerifyDeps` wiring (consent-pull) + `unverified.txt`

**Files:** Modify `src/cli/crew.ts`, `src/cli/flow.ts`; Create `src/verification/deps.ts` (the real `VerifyDeps` factory); Test `tests/cli/verify-deps.test.ts`

**Interfaces:** Produces `makeVerifyDeps({ manager, control, generalModel }): VerifyDeps` where:
- `generate(model, prompt)` = ensureReady(model decl) → `generateText({ model: createOllamaModel({model}), prompt })` → `.text`.
- `getByIds` = the store's `getByIds`.
- `ensureJudge(model)` = if `control.isInstalled(model)` → `{model, fallback:false}`; else per `autoPullPolicy()`: `always`→pull; `prompt`+TTY→ask y/n (readline), pull on yes else `{generalModel, fallback:true}`; `never`→`{generalModel, fallback:true}`. Log the notice on fallback.

- [ ] **Step 1: Failing test** — unit-test `ensureJudge` policy with a fake control (installed → no pull; not-installed + policy 'never' → fallback; 'always' → pull called). No TTY in tests → prompt path uses 'never'/fallback.
- [ ] **Step 2–4:** Implement `makeVerifyDeps`; add `--verify` parsing to `crew.ts`/`flow.ts` that sets the crew/workflow `verify` flag and passes `VerifyDeps`; on an `unverified` outcome write `runs/<id>/unverified.txt` (draft + unsupported claims + faithfulness) instead of `result.txt` and exit non-zero.
- [ ] **Step 5: Run tests + typecheck + lint** → PASS. Commit `feat(cli): --verify flag + consent-pull judge wiring + unverified.txt`.

---

## Task 11: In-repo eval gate (golden set)

**Files:** Create `tests/verification/golden/cases.json`, `tests/verification/faithfulness.eval.test.ts`

- [ ] **Step 1:** Author `cases.json` — ~15–20 `{ id, answer, evidence:[{id,text}], expectedSupported }`, incl. planted hallucinations, uncited-claim, and no-evidence cases.
- [ ] **Step 2:** Write `faithfulness.eval.test.ts` that runs the project's `verify()` with a deps built from a fixed fake `generate` implementing a simple lexical-entailment stand-in (deterministic, offline) OR the general-model fallback path, over each case; assert detection precision/recall ≥ target (e.g. all planted hallucinations flagged; ≤1 false-abstention). Gate it in `bun run check` (it's a normal `bun test`).
> The offline eval uses a deterministic stand-in judge so `bun run check` is hermetic. A `.live` variant (Task 12) runs the SAME golden set through real MiniCheck.
- [ ] **Step 3:** Run + commit `test(verification): in-repo faithfulness golden-set eval gate`.

---

## Task 12: Live test

**Files:** Create `tests/integration/verification.live.test.ts`

- [ ] Mirror `tests/integration/memory.live.test.ts` skip guard (Ollama up). Pull-or-skip `bespoke-minicheck`. Assert: a grounded answer (claim + matching cited chunk) → `supported:true`; a planted hallucination (claim contradicting its cited chunk) → `supported:false` with the claim listed. 180s timeout. Skips cleanly without Ollama/MiniCheck. Commit `test(verification): live MiniCheck faithfulness roundtrip (skips w/o model)`.

---

## Task 13: Docs (architecture.md + README + ROADMAP)

- [ ] Replace the Task-1 stub with a full `## 12. Verification` section in `docs/architecture.md` (mirror §11 depth): the primitive (decompose→cited-evidence→MiniCheck→aggregate), consent-pull + fallback, bounded CRAG, abstention `{kind:'unverified'}`, opt-in `--verify` auto-insertion, spans. Add `src/verification/` to the system-map (crew/workflow → verification → memory `getByIds` + judge model via Model Manager + telemetry). Renumber On-disk/Testing/Glossary → §13/14/15.
- [ ] README: Status → Slice 13; slice-13 row; a Verification feature paragraph; Next → Slice 14 (first-boot provisioning/downloader).
- [ ] ROADMAP: flip "Grounded answers / anti-hallucination" ❌→✅ (Slice 13) in gap table, Phase B table, recommended sequence; note Slice 14 (provisioning/downloader) as next.
- [ ] `bun run check` (all four gates) → green. Commit `docs: bring all four surfaces current through Slice 13 (grounded verification)`.

---

## Task 14: Artifact regen (manual, post-merge)

- [ ] Regenerate the interactive architecture Artifact (same URL): add a **Verification** node + edges (crew/workflow → verification → memory/judge/telemetry), add a **"verify"** scenario to the Terminal mode (answer → decompose → getByIds → MiniCheck per claim → faithfulness score → branch/abstain, with the calc `faithfulness = supported/total ≥ 0.9`), update footer to "Slice 13 · <N> tests". Not a repo file — do after merge.

---

## Self-Review (author checklist — completed)

**Spec coverage:** §2.1 types→T1; §2.9 spans→T2; §2.6 getByIds→T3; §2.2 claims→T4; §2.3 judge+consent→T5(+T10 ensureJudge); §2.4 crag→T6; §2.5 verify→T7; §2.7 auto-insertion→T8(crew)+T9(workflow); §2.8 outcome/abstention→T8+T10; §2.10 config→T1; §2.11 eval→T11; live→T12; docs→T13; Artifact→T14. Consent-pull + fallback → T5/T10. Evidence=cited-chunks → T7 (getByIds by parsed citations).

**Placeholder scan:** No TBD/"handle edge cases". Version-uncertain external APIs (LanceDB `query().where` in T3; the crew/workflow branch-subgraph shape in T8/T9) carry concrete fallbacks + "confirm against the installed API / report DONE_WITH_CONCERNS" — verification instructions, not placeholders. T8/T9/T10 tests are sketched-with-assertions because they bind to `runCrew`/`runFlow` real signatures the implementer must read; the REQUIRED behavior + assertions are stated explicitly.

**Type consistency:** `Verdict`/`Claim`/`ClaimVerdict`/`CragGrade`/`VerifyDeps` defined once (T1), consumed unchanged (T4–T10). `getByIds(space, ids)` signature identical in T3 (store) and T7 (deps). `verify(answer, {query, space, threshold?}, deps)` consistent T7↔T8/T9/T10. `{kind:'unverified'; unsupportedClaims; faithfulness; draft}` identical in T8 (type) and T10 (CLI). Env keys match config.ts (T1) everywhere.

**Note for controller:** T8 is the heavy task (compiler sub-graph). Consider the shared `src/verification/expand.ts` (flagged in T9) to avoid duplicating the verify→branch→corrective→abstain expansion across crew + workflow compilers.
