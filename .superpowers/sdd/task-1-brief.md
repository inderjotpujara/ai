### Task 1: `VerifiedWith` type + `ManifestEntry.verifiedWith?` field + version bump

**Files:**
- Modify: `src/verified-build/types.ts:73` (`ManifestEntry`), `src/verified-build/manifest.ts:8` (`MANIFEST_VERSION`)
- Create: `src/verified-build/verified-with.ts`
- Test: `tests/verified-build/verified-with.test.ts`, extend `tests/verified-build/manifest.test.ts`

**Interfaces:**
- Consumes: `RuntimeKind`, `ModelDeclaration` from `../core/types.ts`.
- Produces (exported from `src/verified-build/types.ts`):
  ```ts
  export type VerifiedWith = {
    runtime: RuntimeKind;   // decl.runtime
    model: string;          // decl.model — the concrete resolved id/tag
    paramsBillions: number; // decl.footprint.approxParamsBillions
    numCtx: number;         // the numCtx resolveModel returned
    quant?: string;         // best-effort, parsed from the model tag (R2); undefined when not derivable
    capturedAtMs: number;   // Date.now() at commit
  };
  ```
  `ManifestEntry` gains `verifiedWith?: VerifiedWith;` as its LAST field (undefined = no baseline / pre-Slice-32 entry).
- Produces (exported from `src/verified-build/verified-with.ts`):
  ```ts
  export function parseQuant(model: string): string | undefined;
  export function verifiedWithFrom(
    resolved: { decl: ModelDeclaration; numCtx: number },
    now?: number,
  ): VerifiedWith;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/verified-build/verified-with.test.ts
import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { parseQuant, verifiedWithFrom } from '../../src/verified-build/verified-with.ts';

test('parseQuant extracts a quant suffix from a model tag, else undefined', () => {
  expect(parseQuant('qwen2.5:7b-instruct-q4_K_M')).toBe('q4_K_M');
  expect(parseQuant('llama3.1-8b-q4_0')).toBe('q4_0');
  expect(parseQuant('qwen2.5:7b')).toBeUndefined();
});

test('verifiedWithFrom maps a resolved decl+numCtx onto a VerifiedWith', () => {
  const vw = verifiedWithFrom(
    {
      decl: {
        runtime: RuntimeKind.Ollama,
        model: 'qwen2.5:7b-instruct-q4_K_M',
        params: {},
        role: 'r',
        footprint: { approxParamsBillions: 7, bytesPerWeight: 0.5 },
      },
      numCtx: 8192,
    },
    1000,
  );
  expect(vw).toEqual({
    runtime: RuntimeKind.Ollama,
    model: 'qwen2.5:7b-instruct-q4_K_M',
    paramsBillions: 7,
    numCtx: 8192,
    quant: 'q4_K_M',
    capturedAtMs: 1000,
  });
});
```

```ts
// tests/verified-build/manifest.test.ts — ADD these two tests
import { MANIFEST_VERSION_FOR_TEST } from '../../src/verified-build/manifest.ts'; // if not exported, assert via readManifest of a fresh dir
// (a) a v1 manifest entry with NO verifiedWith reads back as undefined, never throws:
test('readManifest tolerates a v1 entry with no verifiedWith (undefined, no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vb-'));
  writeFileSync(
    join(dir, '.generated.json'),
    JSON.stringify({
      version: 1,
      entries: {
        a: {
          need: 'n', signature: { purpose: 'n', tools: [], modelTier: '', io: '', roles: [] },
          vector: [], verifiedLevel: 'behaves', goldenPath: `${dir}/a.golden.json`,
          createdAtMs: 1, lastUsedMs: 0, useCount: 0, lastEvalPass: true,
        },
      },
    }),
  );
  const m = readManifest(dir);
  expect(m.entries.a?.verifiedWith).toBeUndefined();
});
// (b) rebuildFromArtifacts leaves verifiedWith undefined (no live resolve offline):
test('rebuildFromArtifacts leaves verifiedWith undefined', () => {
  // seed a <name>.ts + <name>.golden.json in a temp dir with NO manifest, rebuild, assert entry.verifiedWith === undefined
});
```

- [ ] **Step 2: Run tests to verify they fail** — `bun run test:file -- "tests/verified-build/verified-with.test.ts"` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation** — add `VerifiedWith` + the field to `types.ts`; bump `const MANIFEST_VERSION = 2;` (`manifest.ts:8`); create `verified-with.ts`:

```ts
import type { ModelDeclaration } from '../core/types.ts';
import type { VerifiedWith } from './types.ts';

/** Best-effort quant parse from a model tag (R2): matches a trailing/embedded
 *  `qN...` group like `q4_K_M` / `q4_0` / `q8_0`. Undefined when not present —
 *  a quant-only swap may then be invisible to the drift diff (accepted this slice). */
export function parseQuant(model: string): string | undefined {
  const m = model.match(/(q\d+(?:_[0-9a-z]+)*)/i);
  return m ? m[1] : undefined;
}

export function verifiedWithFrom(
  resolved: { decl: ModelDeclaration; numCtx: number },
  now: number = Date.now(),
): VerifiedWith {
  return {
    runtime: resolved.decl.runtime,
    model: resolved.decl.model,
    paramsBillions: resolved.decl.footprint.approxParamsBillions,
    numCtx: resolved.numCtx,
    quant: parseQuant(resolved.decl.model),
    capturedAtMs: now,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass** — `bun run test:file -- "tests/verified-build/verified-with.test.ts" "tests/verified-build/manifest.test.ts"` → PASS.
- [ ] **Step 5: Gate + commit** — `bun run typecheck && bun run lint:file -- src/verified-build/types.ts src/verified-build/manifest.ts src/verified-build/verified-with.ts tests/verified-build/verified-with.test.ts tests/verified-build/manifest.test.ts`.

```bash
git add src/verified-build/types.ts src/verified-build/manifest.ts src/verified-build/verified-with.ts tests/verified-build/verified-with.test.ts tests/verified-build/manifest.test.ts
git commit -m "feat(verified-build): VerifiedWith model-identity type + ManifestEntry.verifiedWith field + MANIFEST_VERSION 1->2"
```

*Model: Sonnet (pure type + helper + tolerance test).*

