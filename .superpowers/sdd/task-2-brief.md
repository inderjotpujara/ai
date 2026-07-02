## Task 2: Minor ③ — consent interactivity predicate + stdin `end` handling

**Files:**
- Modify: `src/provisioning/ui/prompt.ts:1-17` (`stdinInput`) and add `interactiveTTY`
- Modify: `src/mcp/mount.ts:63` (use `interactiveTTY()`)
- Test: `tests/provisioning/prompt.test.ts` (extend; create if absent) and `tests/mcp/mount.test.ts` (extend — see Step 5)

**Interfaces:**
- Consumes: nothing new.
- Produces: `stdinInput(stream?: NodeJS.ReadStream): LineInput` — now accepts an optional stream (defaults to `process.stdin`) and its `read()` resolves `''` on stream `end`. New `interactiveTTY(stdin?: { isTTY?: boolean }, stderr?: { isTTY?: boolean }): boolean` — true only when BOTH are TTYs.

- [ ] **Step 1: Write the failing tests**

Create/extend `tests/provisioning/prompt.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { interactiveTTY, stdinInput } from '../../src/provisioning/ui/prompt.ts';

describe('interactiveTTY', () => {
  it('is true only when both stdin and stderr are TTYs', () => {
    expect(interactiveTTY({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(interactiveTTY({ isTTY: false }, { isTTY: true })).toBe(false); // stdin redirected (< /dev/null)
    expect(interactiveTTY({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(interactiveTTY({}, {})).toBe(false); // isTTY undefined → false
  });
});

describe('stdinInput', () => {
  it('resolves the trimmed line on data', async () => {
    const s = new PassThrough();
    const input = stdinInput(s as unknown as NodeJS.ReadStream);
    const p = input.read();
    s.write('  yes \n');
    expect(await p).toBe('yes');
  });
  it('resolves empty string when the stream ends (never hangs)', async () => {
    const s = new PassThrough();
    const input = stdinInput(s as unknown as NodeJS.ReadStream);
    const p = input.read();
    s.end(); // e.g. stdin was `< /dev/null`
    expect(await p).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/provisioning/prompt.test.ts`
Expected: FAIL — `interactiveTTY` is not exported; the `end` test hangs/times out because `stdinInput` has no `end` handler.

- [ ] **Step 3: Implement in `src/provisioning/ui/prompt.ts`**

Replace `stdinInput` (lines 4-17) and add `interactiveTTY`:

```typescript
export function stdinInput(
  stream: NodeJS.ReadStream = process.stdin,
): LineInput {
  return {
    read: () =>
      new Promise((resolve) => {
        const cleanup = (): void => {
          stream.off('data', onData);
          stream.off('end', onEnd);
        };
        const onData = (d: Buffer): void => {
          cleanup();
          stream.pause();
          resolve(d.toString().trim());
        };
        const onEnd = (): void => {
          cleanup();
          resolve('');
        };
        stream.resume();
        stream.on('data', onData);
        stream.on('end', onEnd);
      }),
  };
}

/** Interactive prompting is safe only when the stream we WRITE the question to
 *  (stderr) and the stream we READ the answer from (stdin) are both TTYs.
 *  Judging on stderr alone lets `cmd < /dev/null` hang on an ended stdin. */
export function interactiveTTY(
  stdin: { isTTY?: boolean } = process.stdin,
  stderr: { isTTY?: boolean } = process.stderr,
): boolean {
  return (stdin.isTTY ?? false) && (stderr.isTTY ?? false);
}
```

- [ ] **Step 4: Wire the predicate into `src/mcp/mount.ts`**

Add `interactiveTTY` to the existing import (line 2):

```typescript
import { askYesNo, interactiveTTY, stdinInput } from '../provisioning/ui/prompt.ts';
```

Change `mount.ts:63` from `isTTY: process.stderr.isTTY ?? false,` to:

```typescript
    isTTY: interactiveTTY(),
```

- [ ] **Step 5: Add a mountAll no-hang regression test**

Add to `tests/mcp/mount.test.ts` (a describe block; adapt imports to the file's existing style — it already imports `mountAll` and builds `McpConfig` fixtures):

```typescript
it('skips consent-gated servers non-interactively without calling ask (no hang)', async () => {
  let asked = 0;
  const config = {
    entries: [
      {
        name: 'needs-consent',
        kind: McpTransportKind.Stdio,
        command: 'echo',
        args: [],
      },
    ],
    dormant: [],
    warnings: [],
  } as unknown as McpConfig;
  const reg = await mountAll(config, {
    approvalsFile: join(await mkdtemp(join(tmpdir(), 'appr-')), 'a.json'),
    consent: {
      isTTY: false,
      autoYes: false,
      ask: async () => {
        asked += 1;
        return true;
      },
    },
    mount: async () => ({ tools: {}, close: async () => {} }),
  });
  expect(asked).toBe(0);
  expect(reg.skipped.some((s) => s.name === 'needs-consent')).toBe(true);
});
```

> If `tests/mcp/mount.test.ts` doesn't exist, create it with the standard header (`import { describe, expect, it } from 'bun:test'`, `mkdtemp`/`tmpdir`/`join`, `mountAll` from `../../src/mcp/mount.ts`, `McpConfig`/`McpTransportKind` from `../../src/mcp/types.ts`) wrapped in `describe('mountAll consent', () => { ... })`. First read `src/mcp/consent.ts`'s `ensureConsent` to confirm the `isTTY:false && !autoYes && !approved` branch returns `false` (skip) rather than prompting — it does; this test guards that path stays wired.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/provisioning/prompt.test.ts tests/mcp/mount.test.ts`
Expected: PASS (no hang on the `end` test; `asked` is 0).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `bun run typecheck`; `bun run lint:file -- "src/provisioning/ui/prompt.ts" "src/mcp/mount.ts"`.

```bash
git add src/provisioning/ui/prompt.ts src/mcp/mount.ts tests/provisioning/prompt.test.ts tests/mcp/mount.test.ts
git commit -m "fix(mcp): consent judges TTY on the stream it reads (stdin) + stdin end resolves empty (Slice 16 Task 2)"
```

---

