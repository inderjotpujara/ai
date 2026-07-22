import type { A2aSkillEntryWire } from '@contracts';
import {
  A2aConfigResponseSchema,
  A2aTokenIssueResponseSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

const OkSchema = z.object({}).passthrough();

/** Federation tab (Slice 31 Incr 7, T24) — the expose-side A2A config: enable
 *  state, exposed skills, card preview, issued-token metadata. Mirrors
 *  `useDevices`'s cancelled-flag-guarded fetch-on-mount + tick-bump-to-refetch
 *  pattern; every mutation (`putSkills`/`issueToken`/`revokeToken`) `refresh()`es.
 *  `issueToken`'s raw Bearer is returned to the caller and NEVER stored in
 *  this hook's state — `GET /api/a2a/config` only ever re-lists metadata. */
export function useA2aConfig() {
  const [config, setConfig] = useState<
    z.infer<typeof A2aConfigResponseSchema> | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    apiFetch('/a2a/config', { schema: A2aConfigResponseSchema })
      .then((r) => !cancelled && setConfig(r))
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
    config,
    error,
    refresh,
    putSkills: (skills: A2aSkillEntryWire[]) =>
      apiFetch('/a2a/skills', {
        method: 'PUT',
        body: { skills },
        schema: OkSchema,
      }).then(refresh),
    issueToken: (label: string) =>
      apiFetch('/a2a/token', {
        method: 'POST',
        body: { label },
        schema: A2aTokenIssueResponseSchema,
      }).then((r) => {
        refresh();
        return r; // {id, token} — shown ONCE by the dialog
      }),
    revokeToken: (id: string) =>
      apiFetch(`/a2a/token/${id}`, {
        method: 'DELETE',
        body: {},
        schema: OkSchema,
      }).then(refresh),
  };
}
