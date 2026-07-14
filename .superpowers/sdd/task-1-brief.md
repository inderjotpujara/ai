### Task 1: Bun workspace + `web/` toolchain bootstrap

Deliverable: `bun run check:web` runs one green Vitest test inside `web/`, and the root gate is extended to invoke it. All build/config scaffolding folds into this task.

**Files:**
- Modify: `package.json` (root), `tsconfig.json` (root)
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/test/setup.ts`
- Test: `web/src/test/harness.test.tsx`

**Interfaces:**
- Consumes: nothing (bootstrap).
- Produces: the `web/` workspace, the `@contracts` alias resolving to `../src/contracts/index.ts`, a working Vitest+happy-dom harness, root scripts `check:web` and an extended `check`.

- [ ] **Step 1: Write the failing test**

`web/src/test/harness.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('web test harness', () => {
  it('renders a DOM node and jest-dom matchers work', () => {
    render(<button type="button">ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });

  it('runs under a cross-origin-isolation-aware DOM', () => {
    // happy-dom provides window; crossOriginIsolated may be undefined in jsdom-likes.
    expect(typeof window).toBe('object');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test 2>&1 | head -20` (or from root once scripts exist: `bun run check:web`)
Expected: FAIL — `web/package.json` / vitest not present ("script not found" / "vitest: command not found").

- [ ] **Step 3: Write the workspace + config**

Root `package.json` — add the workspaces field (top level) and scripts:
```jsonc
{
  // ...existing...
  "workspaces": ["web"],
  "scripts": {
    // ...existing scripts unchanged...
    "check:web": "cd web && bun run typecheck && bun run test",
    "check": "bun run docs:check && bun run typecheck && bun run lint && bun run check:web && bun run test"
  }
}
```
Move `react`, `react-dom`, `@ai-sdk/react` OUT of root `devDependencies` (they go to `web/package.json` below). Leave `ai` and `zod` in root `dependencies` (used by `src/`).

Root `tsconfig.json` — add `"web"` to `exclude`:
```jsonc
{
  // ...
  "exclude": ["scripts/spikes/**/*.tsx", "web"]
}
```

`web/package.json`:
```json
{
  "name": "@local-agents/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@ai-sdk/react": "^3",
    "@tanstack/react-router": "^1",
    "@base-ui-components/react": "^1",
    "@fontsource-variable/geist": "^5",
    "@fontsource-variable/geist-mono": "^5"
  },
  "devDependencies": {
    "vite": "^8",
    "@vitejs/plugin-react": "^6",
    "@tailwindcss/vite": "^4",
    "tailwindcss": "^4",
    "vitest": "^4",
    "happy-dom": "^15",
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "@testing-library/user-event": "^14",
    "typescript": "^5.9.0",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

`web/tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "paths": { "@contracts": ["../src/contracts/index.ts"] }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts') },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
});
```

`web/vitest.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts') },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Local Agents</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// happy-dom does not implement matchMedia; ThemeProvider (Task 3) depends on it.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});
```

- [ ] **Step 4: Install and run the test to verify it passes**

Run: `bun install && bun run check:web`
Expected: `bun run typecheck` clean, then Vitest PASS (2 tests). If Biome later flags `web/`, run `bun run lint` and fix.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json web/
git commit -m "chore(web): bootstrap web/ workspace — Vite 8 + Vitest 4 + happy-dom harness"
```

---

