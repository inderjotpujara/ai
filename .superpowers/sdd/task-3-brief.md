### Task 3: `aria-pressed` on the theme/OS-notify/voice toggles + `aria-label` on the three unnamed `<aside>` landmarks (D1)

**Files:**
- Modify: `web/src/app/app-shell.tsx:82` (theme toggle `<Button>`)
- Modify: `web/src/app/app-shell.test.tsx` (append)
- Modify: `web/src/features/settings/index.tsx:136-161` (OS-notify + voice-input toggle `<Button>`s)
- Modify: `web/src/features/settings/index.test.tsx` (append)
- Modify: `web/src/features/sessions/index.tsx:38` (`<aside data-testid="sessions-sidebar">`)
- Modify: `web/src/features/sessions/index.test.tsx` (append)
- Modify: `web/src/features/workflows/workflow-detail.tsx:111` (`<aside data-testid="step-detail">`)
- Modify: `web/src/features/workflows/workflow-detail.test.tsx` (append)
- Modify: `web/src/features/runs/waterfall.tsx:53` (`<aside data-testid="span-detail">`)
- Modify: `web/src/features/runs/waterfall.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new — `Button` (`web/src/shared/ui/button.tsx`) already forwards arbitrary `ButtonHTMLAttributes`, including `aria-pressed`, via its `...rest` spread.
- Produces: no new exports; five existing elements gain accessibility attributes only (no behavior/prop-shape change).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/app/app-shell.test.tsx` (inside `describe('AppShell', ...)`):

```tsx
it('the theme toggle exposes aria-pressed reflecting dark mode (D1)', async () => {
  renderAt('/');
  const btn = await screen.findByRole('button', { name: /theme/i });
  expect(btn).toHaveAttribute('aria-pressed', 'true'); // ThemeProvider defaults to dark
});
```

Append to `web/src/features/settings/index.test.tsx` (inside `describe('SettingsArea', ...)` for the notify toggle, and inside `describe('SettingsArea — voice input', ...)` for the voice toggle):

```tsx
it('exposes aria-pressed on the OS-notify toggle reflecting its state (D1)', async () => {
  stubNotification('granted');
  renderAt('/settings');
  const btn = await screen.findByTestId('notify-os-toggle');
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(btn);
  expect(await screen.findByText('OS notifications: on')).toBeInTheDocument();
  expect(btn).toHaveAttribute('aria-pressed', 'true');
});
```

```tsx
it('exposes aria-pressed on the voice-input toggle reflecting its state (D1)', async () => {
  renderAt('/settings');
  const btn = await screen.findByTestId('voice-input-toggle');
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-pressed', 'true');
});
```

Append to `web/src/features/sessions/index.test.tsx` (inside `describe('SessionsSidebar', ...)`):

```tsx
it('labels the sidebar landmark for assistive tech (D1)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ items: [], total: 0 })),
  );
  renderAt('/');
  expect(
    await screen.findByRole('complementary', { name: /recent sessions/i }),
  ).toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

Append to `web/src/features/workflows/workflow-detail.test.tsx` (inside `describe('WorkflowDetail', ...)`):

```tsx
it('labels the step-detail landmark for assistive tech (D1)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(detail)),
  );
  renderAt('/workflows/fetch-then-summarize');
  fireEvent.click(await screen.findByTestId('dag-node-fetch'));
  expect(
    await screen.findByRole('complementary', { name: /selected step detail/i }),
  ).toBeInTheDocument();
  vi.unstubAllGlobals();
});
```

Append to `web/src/features/runs/waterfall.test.tsx` (inside `describe('Waterfall', ...)`):

```tsx
it('labels the span-detail landmark for assistive tech (D1)', () => {
  render(<Waterfall spans={[span({ spanId: 'a' })]} />);
  fireEvent.click(screen.getByTestId('bar-a'));
  expect(
    screen.getByRole('complementary', { name: /selected span detail/i }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- app-shell.test.tsx settings/index.test.tsx sessions/index.test.tsx workflows/workflow-detail.test.tsx runs/waterfall.test.tsx`
Expected: FAIL on all five new assertions — none of the five elements has the attribute yet.

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/app/app-shell.tsx:82`:

```tsx
          <Button
            onClick={toggle}
            aria-label={`theme: ${theme}`}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? '☾' : '☀'}
          </Button>
```

Modify `web/src/features/settings/index.tsx` (both toggle buttons):

```tsx
        <Button
          data-testid="notify-os-toggle"
          variant={enabled ? 'accent' : 'default'}
          aria-pressed={enabled}
          onClick={handleToggle}
        >
          {enabled ? 'OS notifications: on' : 'Enable OS notifications'}
        </Button>
```

```tsx
        <Button
          data-testid="voice-input-toggle"
          variant={voiceEnabled ? 'accent' : 'default'}
          aria-pressed={voiceEnabled}
          onClick={() => setVoiceEnabled((v) => !v)}
        >
          {voiceEnabled ? 'Voice input: on' : 'Enable voice input'}
        </Button>
```

Modify `web/src/features/sessions/index.tsx:38`:

```tsx
    <aside
      data-testid="sessions-sidebar"
      aria-label="Recent sessions"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
```

Modify `web/src/features/workflows/workflow-detail.tsx:111`:

```tsx
                <aside
                  data-testid="step-detail"
                  aria-label="Selected step detail"
                  className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
                >
```

Modify `web/src/features/runs/waterfall.tsx:53`:

```tsx
        <aside
          data-testid="span-detail"
          aria-label="Selected span detail"
          className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- app-shell.test.tsx settings/index.test.tsx sessions/index.test.tsx workflows/workflow-detail.test.tsx runs/waterfall.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/app-shell.tsx web/src/app/app-shell.test.tsx web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx web/src/features/sessions/index.tsx web/src/features/sessions/index.test.tsx web/src/features/workflows/workflow-detail.tsx web/src/features/workflows/workflow-detail.test.tsx web/src/features/runs/waterfall.tsx web/src/features/runs/waterfall.test.tsx
git commit -m "feat(a11y): aria-pressed on toggle buttons + aria-label on unnamed aside landmarks (D1)"
```

---

