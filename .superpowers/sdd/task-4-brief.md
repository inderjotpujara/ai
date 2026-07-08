### Task 4: App version + `--version` + `start` scaffold

**Files:**
- Create: `src/version.ts`
- Create: `src/cli/start.ts`
- Create: `tests/version.test.ts`
- Modify: `package.json` (`version` → `0.2.0`; add `"start": "bun run src/cli/start.ts"`)

**Interfaces:**
- Produces: `APP_VERSION: string` (read once from `package.json`); `start` prints a scaffold message (the web server lands in Slice 30b).

- [ ] **Step 1: Write the failing test**

```ts
// tests/version.test.ts
import { expect, test } from 'bun:test';
import { APP_VERSION } from '../src/version.ts';
test('APP_VERSION is a semver string', () => { expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/); });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/version.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Bump `package.json` `"version"` to `"0.2.0"`. Then:

```ts
// src/version.ts
import pkg from '../package.json' with { type: 'json' };
export const APP_VERSION: string = pkg.version;
```

```ts
// src/cli/start.ts
import { APP_VERSION } from '../version.ts';
function main() {
  if (process.argv.includes('--version')) { process.stdout.write(`${APP_VERSION}\n`); return; }
  process.stdout.write(`agent-framework ${APP_VERSION}\nWeb UI starts here in Slice 30b. For now use: bun run src/cli/chat.ts "<task>"\n`);
}
if (import.meta.main) main();
```

Add `"start": "bun run src/cli/start.ts"` to `package.json`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/version.test.ts && bun run start --version && bun run typecheck`
Expected: PASS; `--version` prints `0.2.0`.

- [ ] **Step 5: Commit**

```bash
git add src/version.ts src/cli/start.ts tests/version.test.ts package.json
git commit -m "feat(cli): app version + --version + 'bun run start' scaffold (web server lands in 30b)"
```

---

