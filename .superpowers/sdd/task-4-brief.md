### Task 4: Settings UI — voice-enable toggle + model-tier selector

**Files:**
- Modify: `web/src/features/settings/index.tsx` (full new content shown below)
- Test: `web/src/features/settings/index.test.tsx` (append new `describe` block)

**Interfaces:**
- Consumes: `Button` (`web/src/shared/ui/button.tsx`, unchanged); `window.__AGENT_VOICE_DEFAULT_MODEL__` (Task 3, read as a fallback default; absent/undefined in tests, which is fine — falls back to `'moonshine-base'`).
- Produces: `isVoiceInputEnabled(): boolean` and `voiceModelTier(): ModelTier` accessors (mirroring `isOsNotifyEnabled()`), consumed later by `mic-button.tsx` (Part B). **`ModelTier` is defined HERE temporarily** (`'moonshine-base' | 'moonshine-tiny'`) since `web/src/features/voice/stt-engine.ts` doesn't exist until Task 8; Task 8 makes `stt-engine.ts` the canonical home and updates this file to import it from there instead (documented in Task 8's steps — no permanent duplicate).

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/settings/index.test.tsx` (after the existing `describe('SettingsArea', ...)` block, same file, new `describe`; add `isVoiceInputEnabled, voiceModelTier` to the existing import line):

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { isOsNotifyEnabled, isVoiceInputEnabled, voiceModelTier } from './index.tsx';
```

```tsx
describe('SettingsArea — voice input', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the voice-input toggle, initially off, defaulting the model tier to moonshine-base', async () => {
    renderAt('/settings');
    expect(await screen.findByTestId('voice-input-toggle')).toHaveTextContent(
      'Enable voice input',
    );
    expect(isVoiceInputEnabled()).toBe(false);
    expect(voiceModelTier()).toBe('moonshine-base');
  });

  it('turns voice input on when clicked and persists the choice', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(true);
  });

  it('toggles voice input back off when clicked again while already on', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-input-toggle'));
    expect(await screen.findByText('Enable voice input')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(false);
  });

  it('changes and persists the model tier selection', async () => {
    renderAt('/settings');
    const select = await screen.findByTestId('voice-model-tier');
    fireEvent.change(select, { target: { value: 'moonshine-tiny' } });
    expect(voiceModelTier()).toBe('moonshine-tiny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- settings/index.test.tsx`
Expected: FAIL — `isVoiceInputEnabled`/`voiceModelTier` are not exported from `./index.tsx`; `findByTestId('voice-input-toggle')` never resolves (element doesn't exist).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `web/src/features/settings/index.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';

const STORAGE_KEY = 'agent.notifyOsEnabled';
const VOICE_ENABLED_KEY = 'agent.voiceInputEnabled';
const VOICE_MODEL_TIER_KEY = 'agent.voiceModelTier';

/** Temporary home for `ModelTier` (Slice 30b Phase 7 Task 4) — Task 8 makes
 *  `web/src/features/voice/stt-engine.ts` the canonical definition and this
 *  file switches to importing it from there instead of redefining it. */
export type ModelTier = 'moonshine-base' | 'moonshine-tiny';

function storedPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Read by `use-run-notifications`'s AppShell wiring (T62) to decide whether
 *  a qualifying notification should ALSO fire a browser `Notification`, on
 *  top of the always-on in-app toast. */
export function isOsNotifyEnabled(): boolean {
  return storedPreference();
}

function isModelTier(value: string | null): value is ModelTier {
  return value === 'moonshine-base' || value === 'moonshine-tiny';
}

/** Falls back to the server-injected default (Task 3's
 *  `window.__AGENT_VOICE_DEFAULT_MODEL__`), then to `'moonshine-base'` if
 *  that global is absent (e.g. in tests, or the Phase-1 stub page). */
function defaultModelTier(): ModelTier {
  const fromWindow = (
    globalThis as { __AGENT_VOICE_DEFAULT_MODEL__?: string }
  ).__AGENT_VOICE_DEFAULT_MODEL__;
  return isModelTier(fromWindow ?? null) ? (fromWindow as ModelTier) : 'moonshine-base';
}

function storedVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function storedVoiceModelTier(): ModelTier {
  try {
    const raw = localStorage.getItem(VOICE_MODEL_TIER_KEY);
    return isModelTier(raw) ? raw : defaultModelTier();
  } catch {
    return defaultModelTier();
  }
}

/** Read by `mic-button.tsx` (Part B) to decide whether to mount/enable the
 *  voice-capture affordance at all. */
export function isVoiceInputEnabled(): boolean {
  return storedVoiceEnabled();
}

/** Read by `mic-button.tsx`/`use-voice-input.ts` (Part B) to pick which
 *  Moonshine checkpoint `stt-engine.ts` loads. */
export function voiceModelTier(): ModelTier {
  return storedVoiceModelTier();
}

/** Settings' first real control (replacing the Phase-1 placeholder): an
 *  opt-in toggle for browser `Notification` API alerts, layered on top of
 *  the always-on in-app toast (spec D11 — toast is the fallback, this is
 *  additive). Slice 30b Phase 7 adds a second, independent control block:
 *  voice input enable + model tier (D7), no engine wiring yet — that's
 *  `mic-button.tsx` (Part B). */
export function SettingsArea() {
  const [enabled, setEnabled] = useState(storedPreference);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );
  const [voiceEnabled, setVoiceEnabled] = useState(storedVoiceEnabled);
  const [modelTier, setModelTier] = useState<ModelTier>(storedVoiceModelTier);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore persistence failure — the toggle still applies for the session
    }
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_ENABLED_KEY, String(voiceEnabled));
    } catch {
      // ignore persistence failure — the toggle still applies for the session
    }
  }, [voiceEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_MODEL_TIER_KEY, modelTier);
    } catch {
      // ignore persistence failure — the selection still applies for the session
    }
  }, [modelTier]);

  async function handleToggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return; // user declined — stay off
    } else if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
    ) {
      return; // previously denied outright — nothing to prompt again
    }
    setEnabled(true);
  }

  return (
    <section data-testid="area-settings" className="p-8">
      <h1 className="font-mono text-lg text-[var(--color-fg)]">Settings</h1>
      <div className="mt-4 flex items-center gap-3">
        <Button
          data-testid="notify-os-toggle"
          variant={enabled ? 'accent' : 'default'}
          onClick={handleToggle}
        >
          {enabled ? 'OS notifications: on' : 'Enable OS notifications'}
        </Button>
        {permission === 'denied' && (
          <span className="text-xs text-[var(--color-muted)]">
            Browser permission was denied — enable it in your browser's site
            settings.
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        In-app toasts always fire; OS notifications are an optional extra for
        when this tab isn't focused.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button
          data-testid="voice-input-toggle"
          variant={voiceEnabled ? 'accent' : 'default'}
          onClick={() => setVoiceEnabled((v) => !v)}
        >
          {voiceEnabled ? 'Voice input: on' : 'Enable voice input'}
        </Button>
        <select
          data-testid="voice-model-tier"
          value={modelTier}
          disabled={!voiceEnabled}
          onChange={(e) => setModelTier(e.target.value as ModelTier)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]"
        >
          <option value="moonshine-base">Moonshine base (accurate, ~130MB)</option>
          <option value="moonshine-tiny">Moonshine tiny (fast, ~76MB)</option>
        </select>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Voice input transcribes speech into the composer locally in your
        browser; nothing is sent to a server for transcription. Models
        download on first use.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- settings/index.test.tsx`
Expected: PASS (all pre-existing OS-notify tests + the 4 new voice-input tests).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/index.tsx web/src/features/settings/index.test.tsx
git commit -m "feat(voice): Settings voice-enable toggle + model-tier selector (D7)"
```

---

## Increment 2: Audio capture + downsampler (Tasks 5–6)

