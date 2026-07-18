import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { ModelTier } from '../voice/model-tier.ts';

const STORAGE_KEY = 'agent.notifyOsEnabled';
const VOICE_ENABLED_KEY = 'agent.voiceInputEnabled';
const VOICE_MODEL_TIER_KEY = 'agent.voiceModelTier';

/** Canonical `ModelTier` now lives in `web/src/features/voice/model-tier.ts`
 *  (Task 8, superseding Task 4's temporary local union here) — re-exported
 *  so existing/future importers of it from this module keep working. */
export { ModelTier };

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
  return value === ModelTier.Base || value === ModelTier.Tiny;
}

/** Falls back to the server-injected default (Task 3's
 *  `window.__AGENT_VOICE_DEFAULT_MODEL__`), then to `'moonshine-base'` if
 *  that global is absent (e.g. in tests, or the Phase-1 stub page). */
function defaultModelTier(): ModelTier {
  const fromWindow = (globalThis as { __AGENT_VOICE_DEFAULT_MODEL__?: string })
    .__AGENT_VOICE_DEFAULT_MODEL__;
  return isModelTier(fromWindow ?? null)
    ? (fromWindow as ModelTier)
    : ModelTier.Base;
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
          <option value={ModelTier.Base}>
            Moonshine base (accurate, ~130MB)
          </option>
          <option value={ModelTier.Tiny}>Moonshine tiny (fast, ~76MB)</option>
        </select>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Voice input transcribes speech into the composer locally in your
        browser; nothing is sent to a server for transcription. Models download
        on first use.
      </p>
    </section>
  );
}
