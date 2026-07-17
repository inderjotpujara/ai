import type { RunListResponse } from '@contracts';
import { type RunLifecycle, RunListResponseSchema } from '@contracts';
import { useEffect, useRef } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';
import { diffRunNotifications, type RunNotifyEvent } from './notify-diff.ts';

export type NotifySink = (event: RunNotifyEvent) => void;

/** How much slower the poll cadence backs off to while the tab is hidden —
 *  a multiplier on the configured `pollMs`, never a reset of the seen-map
 *  (spec §7.2 requirement c). */
const HIDDEN_BACKOFF_MULTIPLIER = 4;

/**
 * Polls `GET /api/runs` on `notifyConfig().pollMs`, baselining the seen-map
 * on the first tick (never notifies) and diffing every later tick via the
 * pure `diffRunNotifications` (spec D11/§7.2 — HARD, adversarially
 * verified in T59's own Step 4). Mounted ONCE at the AppShell level (T62),
 * alongside `CommandPalette`.
 *
 * Deliberately does NOT fire an immediate tick at mount — the first poll
 * fires only after one `pollMs` delay. This both matches "poll every N ms"
 * literally (the baseline poll IS the schedule's first tick, not a
 * zero-delay extra one) and, just as importantly, keeps this hook from
 * racing every OTHER component test's own `/api/runs`-adjacent fetch mock:
 * since `AppShell` mounts on every `renderAt(...)` call across the whole web
 * suite and the real default `pollMs` is 5000ms, no synchronous-style
 * vitest test ever lives long enough for this hook's first real tick to
 * fire unless it explicitly configures a tiny `pollMs` via the injected
 * `window.__AGENT_NOTIFY_POLL_MS__` global, as this file's own tests do.
 *
 * `onNotify` is captured in a ref, not a `useEffect` dependency — the poll
 * loop starts once at mount and keeps calling the LATEST `onNotify` without
 * ever tearing down and restarting the loop just because the caller passed
 * a fresh inline closure on some render.
 */
export function useRunNotifications(onNotify: NotifySink): void {
  const seenRef = useRef<Map<string, RunLifecycle>>(new Map());
  const baselinedRef = useRef(false);
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  useEffect(() => {
    let cancelled = false;
    const { pollMs, minDurationMs } = notifyConfig();
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const page = await apiFetch<RunListResponse>('/runs', {
          schema: RunListResponseSchema,
        });
        if (cancelled) return;
        const { nextSeen, toNotify } = diffRunNotifications(
          seenRef.current,
          page.items,
          { baseline: !baselinedRef.current, minDurationMs },
        );
        seenRef.current = nextSeen;
        baselinedRef.current = true;
        for (const event of toNotify) onNotifyRef.current(event);
      } catch {
        // A failed poll tick (network error, non-2xx, a schema mismatch) is
        // silently skipped — never crashes the app, never resets the
        // seen-map, just tries again next tick.
      }
    }

    function schedule() {
      const delay = document.hidden
        ? pollMs * HIDDEN_BACKOFF_MULTIPLIER
        : pollMs;
      timer = setTimeout(async () => {
        if (cancelled) return;
        await tick();
        if (!cancelled) schedule();
      }, delay);
    }

    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
}
