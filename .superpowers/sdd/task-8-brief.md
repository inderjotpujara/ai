### Task 8: `vitest-axe` harness + baseline no-violations assertions + dedicated tab-widget keyboard-nav test (D4)

**Files:**
- Modify: `web/package.json` (new devDependency, via `bun add -D`)
- Modify: `web/src/test/setup.ts` (wire the `toHaveNoViolations` matcher globally)
- Create: `web/src/app/a11y-baseline.test.tsx`
- Create: `web/src/app/tab-widget-keyboard.test.tsx`

**Interfaces:**
- Consumes: `renderAt` (`web/src/test/render.tsx`); `axe`/`vitest-axe/matchers` (new dependency).
- Produces: the `toHaveNoViolations` matcher becomes available to every `.test.tsx` file in `web/` from this task forward (the D4 regression net) — no runtime/production code changes.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/a11y-baseline.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { renderAt } from '../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const emptyList = { items: [], total: 0 };

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
    stop: vi.fn(),
  }),
}));

describe("a11y baseline (vitest-axe, D4) — no violations on the app's key screens", () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(emptyList)));
  });

  it('Chat (/)', async () => {
    const { container } = renderAt('/');
    await waitFor(() => screen.getByTestId('area-chat'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Sessions (/sessions)', async () => {
    const { container } = renderAt('/sessions');
    await waitFor(() => screen.getByTestId('area-sessions'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Runs (/runs)', async () => {
    const { container } = renderAt('/runs');
    await waitFor(() => screen.getByTestId('area-runs'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Library (/library)', async () => {
    const { container } = renderAt('/library');
    await waitFor(() => screen.getByTestId('area-library'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Builders (/builders)', async () => {
    const { container } = renderAt('/builders');
    await waitFor(() => screen.getByTestId('area-builders'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Settings (/settings)', async () => {
    const { container } = renderAt('/settings');
    await waitFor(() => screen.getByTestId('area-settings'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Create `web/src/app/tab-widget-keyboard.test.tsx` (the §6-mandated *dedicated* keyboard-nav test — a cross-cutting characterization test locking in Task 6/7's already-shipped behavior, not new functionality; see Step 2's note):

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render.tsx';

describe('tab widget keyboard pattern (D2, §6) — dedicated arrow-roving + tabpanel-linkage check', () => {
  it('Library: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/library');
    const models = await screen.findByTestId('library-tab-models');
    const memory = screen.getByTestId('library-tab-memory');
    const mcp = screen.getByTestId('library-tab-mcp');

    expect(models).toHaveAttribute('aria-controls', 'library-panel-models');
    expect(memory).toHaveAttribute('aria-controls', 'library-panel-memory');
    expect(mcp).toHaveAttribute('aria-controls', 'library-panel-mcp');
    expect(screen.getByTestId('library-panel-models')).toHaveAttribute(
      'role',
      'tabpanel',
    );

    models.focus();
    fireEvent.keyDown(models, { key: 'ArrowRight' });
    expect(memory).toHaveFocus();
    fireEvent.keyDown(memory, { key: 'ArrowLeft' });
    expect(models).toHaveFocus();
  });

  it('Builders: ArrowRight/ArrowLeft rove focus and each tab links to its panel', async () => {
    renderAt('/builders');
    const agent = await screen.findByTestId('builders-mode-agent');
    const crew = screen.getByTestId('builders-mode-crew');

    expect(agent).toHaveAttribute('aria-controls', 'builders-panel-agent');
    expect(crew).toHaveAttribute('aria-controls', 'builders-panel-crew');

    agent.focus();
    fireEvent.keyDown(agent, { key: 'ArrowRight' });
    expect(crew).toHaveFocus();
    fireEvent.keyDown(crew, { key: 'ArrowRight' });
    expect(agent).toHaveFocus(); // wraps — only 2 tabs
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app/a11y-baseline.test.tsx app/tab-widget-keyboard.test.tsx`
Expected: `a11y-baseline.test.tsx` FAILS at the module-resolution step — `error: Cannot find package 'vitest-axe'` (not installed yet). `tab-widget-keyboard.test.tsx` **passes immediately** — Tasks 6-7 already shipped the underlying roving-tabindex/tabpanel-linkage behavior; this file is a dedicated regression-locking characterization test the spec's §6 explicitly calls for, not a red→green cycle for new functionality. Note this honestly rather than staging a contrived failure.

- [ ] **Step 3: Write minimal implementation**

Run: `cd web && bun add -D vitest-axe`
(Resolves and pins the current version in `web/package.json`/`bun.lock` — do not hand-edit a version number.)

Modify `web/src/test/setup.ts` — add the matcher wiring at the top of the file:

```ts
import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// vitest-axe's `toHaveNoViolations` matcher (D4) — registered once, globally,
// alongside jest-dom's matchers, so every `.test.tsx` file in `web/` can call
// `expect(await axe(container)).toHaveNoViolations()` without per-file setup.
expect.extend(axeMatchers);
```

(The rest of `setup.ts` — the `matchMedia`/`localStorage`/`ResizeObserver`/`confirm`/Web-Audio `beforeEach` fixtures — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app/a11y-baseline.test.tsx app/tab-widget-keyboard.test.tsx`
Expected: PASS (6 baseline screens + 2 keyboard-nav checks).

Run: `cd web && bun run test`
Expected: PASS — the full web suite, confirming the new global `expect.extend` doesn't collide with any existing matcher usage.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/bun.lock web/src/test/setup.ts web/src/app/a11y-baseline.test.tsx web/src/app/tab-widget-keyboard.test.tsx
git commit -m "test(a11y): vitest-axe harness + baseline no-violations + dedicated tab keyboard-nav test (D4)"
```

---


## Increment 2 — Voice a11y + interim ASR + downsampler LPF (Tasks 9–14)

