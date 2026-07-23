import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEvalHistory, useEvals, useReeval } from './use-evals.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function HealthProbe() {
  const { page } = useEvals();
  return (
    <div data-testid="count">
      {page ? String(page.items.length) : 'loading'}
    </div>
  );
}

describe('useEvals', () => {
  it('fetches the eval health list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              artifact: 'weather-agent',
              verifiedLevel: 'behaves',
              regressed: false,
              thumbsDown: 0,
            },
          ],
        }),
      ),
    );
    render(<HealthProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });
});

function HistoryProbe({ artifact }: { artifact: string }) {
  const { page } = useEvalHistory(artifact);
  return (
    <div data-testid="count">
      {page ? String(page.items.length) : 'loading'}
    </div>
  );
}

describe('useEvalHistory', () => {
  it('fetches /api/evals/:artifact', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toBe('/api/evals/weather-agent');
      return jsonResponse({
        items: [
          {
            id: 'row-1',
            artifactId: 'weather-agent',
            model: 'qwen3:8b',
            ts: 1,
            passed: true,
            passedCount: 3,
            total: 3,
            regressed: false,
            perCase: [{ id: 'c1', passed: true, detail: 'ok' }],
            judgeModel: 'qwen3:8b',
            belowBar: false,
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HistoryProbe artifact="weather-agent" />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });
});

function ReevalProbe() {
  const { reevalArtifact, reevalAll } = useReeval(() => {});
  return (
    <>
      <button
        type="button"
        data-testid="go-artifact"
        onClick={() => void reevalArtifact('weather-agent')}
      >
        re-eval artifact
      </button>
      <button
        type="button"
        data-testid="go-all"
        onClick={() => void reevalAll()}
      >
        re-eval all
      </button>
    </>
  );
}

describe('useReeval', () => {
  it('reevalArtifact POSTs /api/evals/reeval with {mode: "artifact", ref}', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ enqueued: 1, jobIds: ['job-1'] }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ReevalProbe />);
    screen.getByTestId('go-artifact').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('/api/evals/reeval');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      mode: 'artifact',
      ref: 'weather-agent',
    });
    vi.unstubAllGlobals();
  });

  it('reevalAll POSTs /api/evals/reeval with {mode: "all"}', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ enqueued: 3, jobIds: ['job-1', 'job-2', 'job-3'] }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ReevalProbe />);
    screen.getByTestId('go-all').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [, init] = call as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'all' });
    vi.unstubAllGlobals();
  });
});
