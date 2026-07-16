import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { ModelsTab } from './models-tab.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseBody(
  frames: { id?: string; data: unknown }[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map(
      (f) =>
        `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`,
    )
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function renderTab() {
  return render(
    <ThemeProvider>
      <ModelsTab />
    </ThemeProvider>,
  );
}

describe('ModelsTab', () => {
  it('lists inventory rows and shows a live progress bar after clicking Pull', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/api/models')) {
          return jsonResponse({
            items: [
              {
                runtime: 'MlxServer',
                model: 'mlx-community/Qwen3.5-30B',
                installed: false,
                fits: true,
                sizeBytes: 20_000_000_000,
              },
            ],
          });
        }
        if (u.endsWith('/api/models/pull') && init?.method === 'POST') {
          return jsonResponse({ runId: 'run-pull-x' });
        }
        if (u.includes('/api/runs/run-pull-x/stream')) {
          return new Response(
            sseBody([
              {
                id: 'e1',
                data: {
                  spanId: 's1',
                  parentSpanId: null,
                  name: 'model.pull.progress',
                  offsetMs: 0,
                  durationMs: 1,
                  depth: 1,
                  status: 'ok',
                  degraded: false,
                  attributes: { 'model.pull.progress.percent': 55 },
                  events: [],
                },
              },
            ]),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('mlx-community/Qwen3.5-30B')).toBeInTheDocument(),
    );
    screen.getByTestId('models-pull-mlx-community/Qwen3.5-30B').click();
    await waitFor(() =>
      expect(
        screen.getByTestId('models-progress-mlx-community/Qwen3.5-30B'),
      ).toHaveTextContent('55%'),
    );
    vi.unstubAllGlobals();
  });

  // Minor #10: `usePullWatch` previously mapped EVERY stream end/error to
  // `done: true`, so a FAILED pull rendered "Done". A root `model.pull` span
  // (`src/telemetry/spans.ts`'s `inSpan`) closing with an ERROR status must
  // render "Failed" instead.
  it('shows "Failed" (not "Done") when the pull run span reports an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/api/models')) {
          return jsonResponse({
            items: [
              {
                runtime: 'MlxServer',
                model: 'mlx-community/Qwen3.5-30B',
                installed: false,
                fits: true,
                sizeBytes: 20_000_000_000,
              },
            ],
          });
        }
        if (u.endsWith('/api/models/pull') && init?.method === 'POST') {
          return jsonResponse({ runId: 'run-pull-fail' });
        }
        if (u.includes('/api/runs/run-pull-fail/stream')) {
          return new Response(
            sseBody([
              {
                id: 'e1',
                data: {
                  spanId: 's1',
                  parentSpanId: null,
                  name: 'model.pull',
                  offsetMs: 0,
                  durationMs: 1,
                  depth: 0,
                  status: 'error',
                  statusMessage: 'network drop mid-download',
                  degraded: false,
                  attributes: {},
                  events: [],
                },
              },
            ]),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('mlx-community/Qwen3.5-30B')).toBeInTheDocument(),
    );
    screen.getByTestId('models-pull-mlx-community/Qwen3.5-30B').click();
    await waitFor(() =>
      expect(
        screen.getByTestId('models-progress-mlx-community/Qwen3.5-30B'),
      ).toHaveTextContent('Failed'),
    );
    vi.unstubAllGlobals();
  });

  // Finding #2, extended to this tab's own launch call: a rejected
  // `POST /api/models/pull` (network drop, non-2xx) must surface an error
  // instead of leaving the Pull button silently inert.
  it('shows an error when the pull launch call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/api/models')) {
          return jsonResponse({
            items: [
              {
                runtime: 'MlxServer',
                model: 'mlx-community/Qwen3.5-30B',
                installed: false,
                fits: true,
                sizeBytes: 20_000_000_000,
              },
            ],
          });
        }
        if (u.endsWith('/api/models/pull') && init?.method === 'POST') {
          return new Response('server error', { status: 500 });
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('mlx-community/Qwen3.5-30B')).toBeInTheDocument(),
    );
    screen.getByTestId('models-pull-mlx-community/Qwen3.5-30B').click();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
