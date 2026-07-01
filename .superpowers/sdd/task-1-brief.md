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

