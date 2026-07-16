import { ModelListResponseSchema } from '../../contracts/index.ts';
import { checkDiskSpace } from '../../provisioning/supervisor.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { discoverModels, type ModelDiscoveryDeps } from './discover.ts';

export type ModelListDeps = {
  freeDiskBytes: () => Promise<number>;
  discovery?: ModelDiscoveryDeps;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/models` (spec §4.2.3) — installed rows (always `fits: true`,
 *  they're already running) plus pullable rows deduped against the installed
 *  set, each flagged with a disk-shortfall estimate against the live free
 *  space. No `provider` field on the wire (Task 5's design note) — which
 *  `DownloadProvider` would fetch a pullable row's weights is resolved
 *  server-side only, at pull time (Task 17). */
export async function handleModelList(deps: ModelListDeps): Promise<Response> {
  const { installed, pullable } = await discoverModels(deps.discovery);
  const free = await deps.freeDiskBytes();
  const installedKeys = new Set(
    installed.map((d) => `${d.runtime}::${d.model}`),
  );

  const installedItems = installed.map((d) => ({
    runtime: d.runtime,
    model: d.model,
    installed: true,
    fits: true,
  }));

  const pullableItems = pullable
    .filter((c) => !installedKeys.has(`${c.runtime}::${c.model}`))
    .map((c) => {
      const sizeBytes =
        c.fileSizeBytes > 0 ? c.fileSizeBytes : c.estimatedBytes;
      const preflight = checkDiskSpace({
        requiredBytes: sizeBytes,
        freeBytes: free,
      });
      return {
        runtime: c.runtime,
        model: c.model,
        installed: false,
        fits: c.fits,
        sizeBytes,
        shortfallBytes: preflight.ok ? undefined : preflight.shortfallBytes,
      };
    });

  return json(
    ModelListResponseSchema.parse({
      items: [...installedItems, ...pullableItems],
    }),
    200,
  );
}
