### Task 12: @visx deps + `--color-danger` token

**Files:**
- Modify: `web/package.json` (add @visx deps), `web/src/shared/design/tokens.css` (add `--color-danger` light+dark)
- Test: `web/src/shared/design/tokens.test.ts` (asserts the token exists in both theme scopes)

**Interfaces:**
- Produces: `@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/group`, `@visx/tooltip` in `web` dependencies (NOT `@xyflow` — D1). A `--color-danger` CSS var under both `:root` (dark) and `:root:where(.light)` (light), following the file's existing split (literal in `:root`, not `@theme`).

- [ ] **Step 1: Install deps** — `cd web && bun add @visx/scale @visx/shape @visx/axis @visx/group @visx/tooltip` (bun resolves the current @visx majors; commit the resulting `web/package.json` + lockfile).

- [ ] **Step 2: Write the failing test** — `web/src/shared/design/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, './tokens.css'), 'utf8');

describe('design tokens', () => {
  it('defines --color-danger in both the dark and light scopes', () => {
    const dark = css.slice(css.indexOf(':root {'), css.indexOf(':root:where(.light)'));
    const light = css.slice(css.indexOf(':root:where(.light)'));
    expect(dark).toContain('--color-danger');
    expect(light).toContain('--color-danger');
  });
});
```

- [ ] **Step 3: Run to fail** — `cd web && bun run test src/shared/design/tokens.test.ts` → FAIL.

- [ ] **Step 4: Minimal impl** — add to `web/src/shared/design/tokens.css`, in the `:root {` block add `--color-danger: #F0616D;` and in `:root:where(.light) {` add `--color-danger: #D22B3A;` (blueprint-consistent reds; dark slightly lighter for contrast on the dark bg).

- [ ] **Step 5: Run to pass + build sanity** — `cd web && bun run test src/shared/design/tokens.test.ts` → PASS; `cd web && bun run typecheck` clean; `cd web && bun run build` succeeds (proves the new deps resolve).

- [ ] **Step 6: Gate + commit**

```bash
cd web && bun run typecheck
git add web/package.json web/bun.lock web/src/shared/design/tokens.css web/src/shared/design/tokens.test.ts
git commit -m "chore(web): add @visx (scale/shape/axis/group/tooltip) + --color-danger token"
```

---

