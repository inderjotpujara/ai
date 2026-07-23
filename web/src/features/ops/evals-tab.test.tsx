import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const REGRESSED_ITEM = {
  artifact: 'weather-agent',
  verifiedLevel: 'behaves',
  baselineModel: 'qwen3:8b',
  currentModel: 'llama3:8b',
  regressed: true,
  thumbsDown: 2,
  latest: {
    id: 'row-1',
    artifactId: 'weather-agent',
    model: 'llama3:8b',
    baselineModel: 'qwen3:8b',
    ts: 1,
    passed: false,
    passedCount: 2,
    total: 3,
    regressed: true,
    perCase: [
      { id: 'c1', passed: true, detail: 'ok' },
      { id: 'c2', passed: false, detail: 'wrong units' },
    ],
    judgeModel: 'qwen3:8b',
    belowBar: true,
  },
};

const FRESH_ITEM = {
  artifact: 'never-evaled-agent',
  verifiedLevel: 'behaves',
  baselineModel: 'qwen3:8b',
  regressed: false,
  thumbsDown: 0,
};

function healthBody(items: unknown[] = [REGRESSED_ITEM, FRESH_ITEM]) {
  return { items };
}

function mockFetch(opts?: {
  health?: unknown;
  reevalStatus?: number;
  historyItems?: unknown[];
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/evals') && method === 'GET') {
      return jsonResponse(opts?.health ?? healthBody());
    }
    if (url.endsWith('/api/evals/reeval') && method === 'POST') {
      return jsonResponse(
        { enqueued: 1, jobIds: ['job-1'] },
        opts?.reevalStatus ?? 202,
      );
    }
    if (url.includes('/api/evals/') && method === 'GET') {
      return jsonResponse({ items: opts?.historyItems ?? [] });
    }
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
}

describe('EvalsTab', () => {
  it('renders per-artifact health with regressed cells highlighted', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops?tab=evals');

    expect(await screen.findByTestId('ops-evals')).toBeInTheDocument();
    expect(
      screen.getByTestId('ops-eval-row-weather-agent'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('ops-eval-row-never-evaled-agent'),
    ).toBeInTheDocument();

    const regressedRow = screen.getByTestId('ops-eval-row-weather-agent');
    expect(regressedRow).toHaveAttribute('data-regressed', 'true');

    // The failing case (c2) is the regressed cell; the passing case (c1) is not.
    const regressedCell = screen.getByTestId('ops-eval-case-weather-agent-c2');
    expect(regressedCell).toHaveAttribute('data-regressed', 'true');
    expect(
      screen.getByTestId('ops-eval-case-weather-agent-c1'),
    ).not.toHaveAttribute('data-regressed');

    // 👎 count surfaces even though it's 0 for the never-evaled artifact.
    expect(
      screen.getByTestId('ops-eval-row-never-evaled-agent'),
    ).toHaveTextContent('👎 0');

    vi.unstubAllGlobals();
  });

  it('the re-eval-now button posts to /api/evals/reeval', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=evals');
    await screen.findByTestId('ops-evals');

    fireEvent.click(screen.getByTestId('ops-eval-reeval-weather-agent'));

    await waitFor(() => {
      const reevalCall = fetchMock.mock.calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : input.toString();
        return url.endsWith('/api/evals/reeval') && init?.method === 'POST';
      });
      expect(reevalCall).toBeDefined();
    });
    const reevalCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.endsWith('/api/evals/reeval') && init?.method === 'POST';
    });
    const [, init] = reevalCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      mode: 'artifact',
      ref: 'weather-agent',
    });

    vi.unstubAllGlobals();
  });

  it('expanding the trend shows verdict points from eval_history', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        historyItems: [
          {
            id: 'row-1',
            artifactId: 'weather-agent',
            model: 'llama3:8b',
            ts: 1,
            passed: false,
            passedCount: 2,
            total: 3,
            regressed: true,
            perCase: [],
            judgeModel: 'qwen3:8b',
            belowBar: true,
          },
        ],
      }),
    );
    renderAt('/ops?tab=evals');
    await screen.findByTestId('ops-evals');

    fireEvent.click(screen.getByTestId('ops-eval-trend-toggle-weather-agent'));

    expect(
      await screen.findByTestId('ops-eval-trend-weather-agent'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ops-eval-trend-point-row-1')).toHaveAttribute(
      'data-regressed',
      'true',
    );

    vi.unstubAllGlobals();
  });
});

describe('Ops shell registers the Evals tab', () => {
  it('renders beside Federation', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops');
    expect(await screen.findByTestId('area-ops')).toBeInTheDocument();
    expect(screen.getByTestId('ops-tab-evals')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Evals' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
