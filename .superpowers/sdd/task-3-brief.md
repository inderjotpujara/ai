### Task 3: `AGENT_WEB_VOICE_*` config entries + `renderIndexHtml` window globals

**Files:**
- Modify: `src/config/schema.ts` (append two entries to `CONFIG_SPEC`, after the `AGENT_WEB_NOTIFY_MIN_DURATION_MS` entry at line 511)
- Modify: `src/server/main.ts:62-101,200-203` (`NotifyConfig`/`DEFAULT_NOTIFY_CONFIG` neighbors gain a `VoiceWindowConfig`/`DEFAULT_VOICE_CONFIG` pair; `renderIndexHtml` gains a 4th parameter; the `startWebServer` call site threads `cfg.AGENT_WEB_VOICE_*` through)
- Test: `tests/config/schema.test.ts` (append), `tests/server/main.test.ts` (append)

**Interfaces:**
- Consumes: `ConfigEntry`/`CONFIG_SPEC`/`loadConfig` (`src/config/schema.ts`, unchanged shape); `renderIndexHtml`'s existing `token`/`distIndexHtml`/`notify` parameters and `tokenScript` string-building mechanism (`src/server/main.ts:69-80`).
- Produces: `AGENT_WEB_VOICE_DEFAULT_MODEL` (string, default `'moonshine-base'`) and `AGENT_WEB_VOICE_VAD_SILENCE_MS` (number, default `800`) config keys; `window.__AGENT_VOICE_DEFAULT_MODEL__` / `window.__AGENT_VOICE_VAD_SILENCE_MS__` injected globals, read later by `web/src/features/settings/index.tsx` (Task 4) and `web/src/features/voice/*` (Tasks 5-9, Part B).

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/schema.test.ts`:

```ts
test('AGENT_WEB_VOICE_DEFAULT_MODEL defaults to moonshine-base', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_WEB_VOICE_DEFAULT_MODEL).toBe('moonshine-base');
  expect(sources.AGENT_WEB_VOICE_DEFAULT_MODEL).toBe('default');
});
test('AGENT_WEB_VOICE_VAD_SILENCE_MS defaults to 800', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_WEB_VOICE_VAD_SILENCE_MS).toBe(800);
  expect(sources.AGENT_WEB_VOICE_VAD_SILENCE_MS).toBe('default');
});
```

Append to `tests/server/main.test.ts`:

```ts
test('renderIndexHtml also injects the voice config (defaults) alongside the token', () => {
  const html = renderIndexHtml('tok-999');
  expect(html).toContain('window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-base"');
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=800');
});

test('renderIndexHtml threads an explicit voice config through', () => {
  const html = renderIndexHtml('tok-1000', undefined, undefined, {
    defaultModel: 'moonshine-tiny',
    vadSilenceMs: 1200,
  });
  expect(html).toContain('window.__AGENT_VOICE_DEFAULT_MODEL__="moonshine-tiny"');
  expect(html).toContain('window.__AGENT_VOICE_VAD_SILENCE_MS__=1200');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/config/schema.test.ts tests/server/main.test.ts`
Expected: FAIL — `values.AGENT_WEB_VOICE_DEFAULT_MODEL` is `undefined` (no such config entry yet); `renderIndexHtml` doesn't accept/inject a 4th param yet (the two new assertions on `html` fail — the strings aren't present).

- [ ] **Step 3: Write minimal implementation**

In `src/config/schema.ts`, append two entries to `CONFIG_SPEC` immediately after the `AGENT_WEB_NOTIFY_MIN_DURATION_MS` entry (before the closing `];` at line 512):

```ts
  {
    env: 'AGENT_WEB_VOICE_DEFAULT_MODEL',
    kind: 'string',
    def: 'moonshine-base',
    doc: "Default Moonshine model tier for browser voice input (web/src/features/voice/stt-engine.ts): 'moonshine-base' (~120-150MB, default, better accuracy) or 'moonshine-tiny' (~76MB, faster/lighter). Injected into the served page as window.__AGENT_VOICE_DEFAULT_MODEL__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.",
  },
  {
    env: 'AGENT_WEB_VOICE_VAD_SILENCE_MS',
    kind: 'number',
    def: 800,
    doc: 'Sustained silence (ms) that closes a tap-to-toggle voice segment (web/src/features/voice/vad.ts Segmenter). Injected into the served page as window.__AGENT_VOICE_VAD_SILENCE_MS__ (server/main.ts renderIndexHtml). Slice 30b Phase 7.',
  },
```

In `src/server/main.ts`, add a `VoiceWindowConfig` type + default next to `NotifyConfig`/`DEFAULT_NOTIFY_CONFIG` (around line 62-67):

```ts
export type NotifyConfig = { pollMs: number; minDurationMs: number };

const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  pollMs: 5_000,
  minDurationMs: 60_000,
};

export type VoiceWindowConfig = { defaultModel: string; vadSilenceMs: number };

const DEFAULT_VOICE_CONFIG: VoiceWindowConfig = {
  defaultModel: 'moonshine-base',
  vadSilenceMs: 800,
};
```

Update `renderIndexHtml`'s signature and `tokenScript` build (lines 69-80) to accept and inject a 4th parameter:

```ts
export function renderIndexHtml(
  token: string,
  distIndexHtml?: string,
  notify: NotifyConfig = DEFAULT_NOTIFY_CONFIG,
  voice: VoiceWindowConfig = DEFAULT_VOICE_CONFIG,
): string {
  // JSON.stringify does not escape `</`, so a token value could break out of
  // the <script> tag; escape `<` to a unicode escape before interpolating.
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  const tokenScript =
    `<script>window.__AGENT_TOKEN__=${safeToken};` +
    `window.__AGENT_NOTIFY_POLL_MS__=${JSON.stringify(notify.pollMs)};` +
    `window.__AGENT_NOTIFY_MIN_DURATION_MS__=${JSON.stringify(notify.minDurationMs)};` +
    `window.__AGENT_VOICE_DEFAULT_MODEL__=${JSON.stringify(voice.defaultModel)};` +
    `window.__AGENT_VOICE_VAD_SILENCE_MS__=${JSON.stringify(voice.vadSilenceMs)};</script>`;
```

(The rest of `renderIndexHtml`'s body — the `distIndexHtml` branch and the Phase-1 stub fallback — is unchanged; both already just concatenate `tokenScript` wherever it was used, so the extra globals ride along automatically.)

Update the `startWebServer` call site (around line 200-203) to thread the real config values through:

```ts
    indexHtml: renderIndexHtml(
      token,
      distIndexHtml,
      {
        pollMs: cfg.AGENT_WEB_NOTIFY_POLL_MS as number,
        minDurationMs: cfg.AGENT_WEB_NOTIFY_MIN_DURATION_MS as number,
      },
      {
        defaultModel: cfg.AGENT_WEB_VOICE_DEFAULT_MODEL as string,
        vadSilenceMs: cfg.AGENT_WEB_VOICE_VAD_SILENCE_MS as number,
      },
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/config/schema.test.ts tests/server/main.test.ts`
Expected: PASS (all existing + new assertions, including the pre-existing notify-config tests which must still pass unchanged since `notify`/`voice` are independent parameters).

Run: `bun run typecheck && bun run lint:file -- "src/config/schema.ts" "src/server/main.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/server/main.ts tests/config/schema.test.ts tests/server/main.test.ts
git commit -m "feat(voice): add AGENT_WEB_VOICE_* config + renderIndexHtml window globals (D7)"
```

