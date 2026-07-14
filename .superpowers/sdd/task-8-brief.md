### Task 8: Security — media-path confinement (realpath ∈ dir)

**Files:**
- Create: `src/server/security/media-path.ts`
- Test: `tests/server/media-path.test.ts`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `node:os` (test only).
- Produces: `class MediaPathError extends Error`; `confineToDir(candidate: string, root: string): string` — returns the realpath when it resolves inside `root`, else throws `MediaPathError`.

- [ ] **Step 1: Write the failing confinement test**

```ts
// tests/server/media-path.test.ts
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { MediaPathError, confineToDir } from '../../src/server/security/media-path.ts';

test('a file inside the root resolves to its realpath', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  writeFileSync(join(root, 'upload.png'), 'x');
  expect(confineToDir('upload.png', root)).toBe(join(root, 'upload.png'));
});

test('a ../ traversal is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  expect(() => confineToDir('../../etc/passwd', root)).toThrow(MediaPathError);
});

test('an absolute path outside the root is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  expect(() => confineToDir('/etc/hosts', root)).toThrow(MediaPathError);
});

test('a symlink escaping the root is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'mp-'));
  const outside = mkdtempSync(join(tmpdir(), 'out-'));
  writeFileSync(join(outside, 'secret.txt'), 's');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  expect(() => confineToDir('link.txt', root)).toThrow(MediaPathError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/media-path.test.ts`
Expected: FAIL — cannot resolve `../../src/server/security/media-path.ts`.

- [ ] **Step 3: Write the media-path module**

```ts
// src/server/security/media-path.ts
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** A network-supplied media path resolved outside its allowed directory. */
export class MediaPathError extends Error {
  constructor(readonly candidate: string) {
    super(`media path escapes the allowed directory: ${candidate}`);
    this.name = 'MediaPathError';
  }
}

/**
 * Resolve `candidate` (relative to `root`, or absolute) and assert its REALPATH
 * is `root` itself or a descendant of it — defeating `../` traversal and symlink
 * escapes. Used to confine network-supplied media to the run/upload dir; the
 * server also disables `ingestMedia`'s filesystem auto-detect (that wiring lands
 * with the chat/media endpoints in a later phase — this util is its primitive).
 */
export function confineToDir(candidate: string, root: string): string {
  const realRoot = realpathSync(resolve(root));
  let real: string;
  try {
    real = realpathSync(resolve(realRoot, candidate));
  } catch {
    throw new MediaPathError(candidate);
  }
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new MediaPathError(candidate);
  }
  return real;
}
```

- [ ] **Step 4: Run confinement test to verify it passes**

Run: `bun test tests/server/media-path.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/security/media-path.ts tests/server/media-path.test.ts
git commit -m "feat(server): add realpath media-path confinement util"
```

---

