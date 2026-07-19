import type { DeviceDTO } from '@contracts';
import { DeviceListResponseSchema, DevicePairResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

const OkSchema = z.object({}).passthrough();
const RotateSchema = z.object({ token: z.string() });

/** Devices & Access tab data + actions (Slice 25b Incr 7, T36). Mirrors
 *  `useJobs`'s cancelled-flag-guarded fetch-on-mount pattern; `refresh` bumps
 *  a tick to re-run the effect after pair/revoke/rotate mutate server state.
 *  NOTE (security, carried from the Fable T17 finding): device `label` is
 *  stored unsanitized server-side — any UI that renders `DeviceDTO.label`
 *  MUST use plain React text interpolation, never `dangerouslySetInnerHTML`.
 *  This hook only fetches/mutates data; it renders nothing itself. */
export function useDevices() {
  const [devices, setDevices] = useState<DeviceDTO[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    apiFetch('/devices', { schema: DeviceListResponseSchema })
      .then((r) => !cancelled && setDevices(r.items))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : 'failed'),
      );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);
  return {
    devices,
    error,
    refresh,
    pair: (label: string) =>
      apiFetch('/devices', {
        method: 'POST',
        body: { label },
        schema: DevicePairResponseSchema,
      }).then((r) => {
        refresh();
        return r; // {deviceId, token, pairingUrl} — shown ONCE by the dialog
      }),
    revoke: (deviceId: string) =>
      apiFetch(`/devices/${deviceId}/revoke`, {
        method: 'POST',
        body: {},
        schema: OkSchema,
      }).then(refresh),
    rotate: (rootSecret: string) =>
      apiFetch('/security/rotate-root', {
        method: 'POST',
        body: { rootSecret },
        schema: RotateSchema,
      }).then((r) => {
        // Adopt the re-minted local token so the current tab survives (§7.1e).
        try {
          localStorage.setItem('agent.pairedToken', r.token);
        } catch {
          /* ignore */
        }
        refresh();
        return r;
      }),
  };
}
