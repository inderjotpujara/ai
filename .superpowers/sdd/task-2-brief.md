### Task 2: Real `<label>`/`htmlFor` for the composer textarea + the Settings model-tier `<select>` (D1)

**Files:**
- Modify: `web/src/shared/ai-elements/prompt-input.tsx` (lines 46-54 — add a `.sr-only` `<label>`, give the textarea an `id`)
- Modify: `web/src/shared/ai-elements/smoke.test.tsx` (append assertion)
- Modify: `web/src/features/settings/index.tsx:162-173` (add a `.sr-only` `<label>`, give the select an `id`)
- Modify: `web/src/features/settings/index.test.tsx` (append assertion)

**Interfaces:**
- Consumes: `.sr-only` (Task 1).
- Produces: `<PromptInput>`'s textarea is reachable via `getByLabelText(/message/i)`; the Settings model-tier select is reachable via `getByLabelText(/voice model tier/i)`. No prop/signature changes — both components keep their existing public interfaces.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/shared/ai-elements/smoke.test.tsx`:

```tsx
it('associates a real (visually-hidden) label with the composer textarea (D1)', () => {
  render(
    <PromptInput value="" onChange={() => {}} onSubmit={() => {}} />,
  );
  expect(screen.getByLabelText(/message/i)).toBe(screen.getByRole('textbox'));
});
```

Append to `web/src/features/settings/index.test.tsx` (inside the existing `describe('SettingsArea — voice input', ...)` block):

```tsx
it('associates a real (visually-hidden) label with the voice model-tier select (D1)', async () => {
  renderAt('/settings');
  expect(await screen.findByLabelText(/voice model tier/i)).toBe(
    screen.getByTestId('voice-model-tier'),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- ai-elements/smoke.test.tsx settings/index.test.tsx`
Expected: FAIL — `getByLabelText` finds no matching element in either case (no `<label>` exists yet).

- [ ] **Step 3: Write minimal implementation**

Modify `web/src/shared/ai-elements/prompt-input.tsx` (inside the `<form>`, immediately before the `<textarea>`):

```tsx
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
      />
```

Modify `web/src/features/settings/index.tsx` (inside the voice-input `<div>`, immediately before the `<select>`):

```tsx
        <label htmlFor="voice-model-tier" className="sr-only">
          Voice model tier
        </label>
        <select
          id="voice-model-tier"
          data-testid="voice-model-tier"
          value={modelTier}
          disabled={!voiceEnabled}
          onChange={(e) => setModelTier(e.target.value as ModelTier)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]"
        >
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- ai-elements/smoke.test.tsx settings/index.test.tsx`
Expected: PASS.

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/shared/ai-elements/prompt-input.tsx web/src/shared/ai-elements/smoke.test.tsx web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
git commit -m "feat(a11y): real labels for the composer textarea + voice model-tier select (D1)"
```

---

