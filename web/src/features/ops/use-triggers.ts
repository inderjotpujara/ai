import type {
  TriggerCreateRequest,
  TriggerCreateResponse,
  TriggerDTO,
  TriggerListResponse,
} from '@contracts';
import {
  JobLaunchResponseSchema,
  TriggerCreateResponseSchema,
  TriggerDtoSchema,
  TriggerListResponseSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

const DeleteOkSchema = z.object({ deleted: z.boolean() });

/** Trigger list + mutations (Slice 25 web console, Task 27). Mirrors
 *  `useJobs`'s `reloadTick` refetch pattern against `GET /api/triggers` — a
 *  plain array, no cursor (`TriggerListResponseSchema`'s idiom; small
 *  in-memory/on-disk set). Each mutation (`create`/`setEnabled`/`remove`/
 *  `fire`) calls `refresh()` afterward so the list reconciles with server
 *  state, the `useDevices` pair/revoke/rotate idiom. This hook only
 *  fetches/mutates data; it renders nothing itself — the table/dialog/drawer
 *  UI is Task 28-30. */
export function useTriggers() {
  const [triggers, setTriggers] = useState<TriggerDTO[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/triggers', { schema: TriggerListResponseSchema })
      .then((result: TriggerListResponse) => {
        if (!cancelled) setTriggers(result.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTriggers(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load triggers',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const refresh = () => setReloadTick((t) => t + 1);

  return {
    triggers,
    error,
    refresh,
    create: (body: TriggerCreateRequest): Promise<TriggerCreateResponse> =>
      apiFetch('/triggers', {
        method: 'POST',
        body,
        schema: TriggerCreateResponseSchema,
      }).then((r) => {
        refresh();
        return r; // {trigger, webhookToken?, webhookUrl?} — token shown ONCE
      }),
    setEnabled: (id: string, enabled: boolean): Promise<TriggerDTO> =>
      apiFetch(`/triggers/${id}`, {
        method: 'PATCH',
        body: { enabled },
        schema: TriggerDtoSchema,
      }).then((r) => {
        refresh();
        return r;
      }),
    remove: (id: string) =>
      apiFetch(`/triggers/${id}`, {
        method: 'DELETE',
        body: {},
        schema: DeleteOkSchema,
      }).then((r) => {
        refresh();
        return r;
      }),
    fire: (id: string) =>
      apiFetch(`/triggers/${id}/fire`, {
        method: 'POST',
        body: {},
        schema: JobLaunchResponseSchema,
      }).then((r) => {
        refresh();
        return r; // {jobId, runId} — the launched job, for a "view job" link
      }),
  };
}
