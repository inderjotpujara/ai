import { ProviderError } from '../../core/errors.ts';
import { ProviderKind } from '../../core/types.ts';
import { ProgressTracker } from '../progress-tracker.ts';
import { DownloadPhase, type DownloadProvider } from '../types.ts';

const DEFAULT_BASE_URL = 'http://localhost:1234';

type DownloadJob = {
  job_id?: string;
  status: string;
  total_size_bytes?: number;
};
type JobStatus = {
  status: string;
  downloaded_bytes?: number;
  total_size_bytes?: number;
};

/** LM Studio local REST download: start a job, poll status → normalized progress. */
export function createLmStudioProvider(
  deps: { baseUrl?: string; fetchImpl?: typeof fetch; pollMs?: number } = {},
): DownloadProvider {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pollMs = deps.pollMs ?? 1000;
  return {
    kind: ProviderKind.LmStudio,
    async download(modelRef, { onProgress, signal }) {
      // destDir is ignored: the LM Studio daemon owns its own model store on disk.
      const tracker = new ProgressTracker(modelRef);
      onProgress(tracker.update(DownloadPhase.Resolving, 0, null));
      const start = await fetchImpl(`${baseUrl}/api/v1/models/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelRef }),
        signal,
      });
      if (!start.ok)
        throw new ProviderError(`LM Studio download returned ${start.status}`);
      const job = (await start.json()) as DownloadJob;
      if (job.status === 'already_downloaded') {
        onProgress(tracker.update(DownloadPhase.Done, 0, 0));
        return;
      }
      const total = job.total_size_bytes ?? null;
      for (;;) {
        if (signal.aborted)
          throw new ProviderError('LM Studio download aborted');
        const st = await fetchImpl(
          `${baseUrl}/api/v1/models/download/${job.job_id}`,
          { signal },
        );
        if (!st.ok)
          throw new ProviderError(`LM Studio status returned ${st.status}`);
        const s = (await st.json()) as JobStatus;
        onProgress(
          tracker.update(
            DownloadPhase.Downloading,
            s.downloaded_bytes ?? 0,
            s.total_size_bytes ?? total,
          ),
        );
        if (s.status === 'completed') {
          onProgress(
            tracker.update(
              DownloadPhase.Done,
              s.downloaded_bytes ?? 0,
              s.total_size_bytes ?? total ?? 0,
            ),
          );
          return;
        }
        if (s.status === 'failed')
          throw new ProviderError(`LM Studio download failed for ${modelRef}`);
        if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
