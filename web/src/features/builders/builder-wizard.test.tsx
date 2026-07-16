import { BuilderKind } from '@contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { BuilderWizard } from './builder-wizard.tsx';

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

function renderWizard() {
  return render(
    <ThemeProvider>
      <BuilderWizard kind={BuilderKind.Agent} title="Agent Builder" />
    </ThemeProvider>,
  );
}

describe('BuilderWizard', () => {
  it('streams narration, then renders the DagView on a written agent result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            // Wire shape confirmed against `src/server/builders/build.ts` +
            // `use-build-events.test.ts`'s integration test: `data-run-start`/
            // `data-confirm`/`data-run-end` ride the wire wrapped in an
            // AI-SDK data-part envelope (`{ type, data: <StatusEvent>,
            // transient: true }`); the terminal `BuildResultDTO` is a
            // one-shot `data-build-result` DATA part (`{ type, data: <DTO> }`),
            // not a `text-delta` carrying a JSON string as the task-14 brief's
            // original snippet modeled it (a Task-11 adversarial-verification
            // deviation already applied in `use-build-events.ts`).
            sseBody([
              {
                id: 'e1',
                data: {
                  type: 'data-run-start',
                  data: {
                    type: 'data-run-start',
                    runId: 'run-x',
                    task: 'fetch quotes',
                  },
                  transient: true,
                },
              },
              { id: 'e2', data: { type: 'text-start', id: 'narration-0' } },
              {
                id: 'e3',
                data: {
                  type: 'text-delta',
                  id: 'narration-0',
                  delta: 'Generated proposal stock_quotes',
                },
              },
              { id: 'e4', data: { type: 'text-end', id: 'narration-0' } },
              {
                id: 'e5',
                data: {
                  type: 'data-build-result',
                  data: {
                    kind: 'written',
                    name: 'stock_quotes',
                    files: ['agents/stock_quotes.ts'],
                    proposal: {
                      name: 'stock_quotes',
                      description: 'Fetches live stock quotes',
                      systemPrompt: 'x',
                      modelReq: {
                        role: 'r',
                        requires: ['tools'],
                        prefer: 'largest-that-fits',
                      },
                      suggestedServers: [
                        { packName: 'finance', scopeToAgent: 'stock_quotes' },
                      ],
                      rationale: 'why',
                    },
                  },
                },
              },
              {
                id: 'e6',
                data: {
                  type: 'data-run-end',
                  data: {
                    type: 'data-run-end',
                    runId: 'run-x',
                    outcome: 'written',
                  },
                  transient: true,
                },
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-need'), {
      target: { value: 'fetch stock quotes' },
    });
    fireEvent.click(screen.getByTestId('wizard-submit'));
    await waitFor(() =>
      expect(
        screen.getByText('Generated proposal stock_quotes'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('dag-view')).toBeInTheDocument(),
    );
    expect(screen.getByText('Created "stock_quotes".')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders a ConfirmPrompt on data-confirm and answers it via POST /api/runs/:id/respond', async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (
          init?.method === 'POST' &&
          typeof url === 'string' &&
          url.includes('/respond')
        ) {
          posted.push({
            url,
            body: init.body ? JSON.parse(init.body as string) : undefined,
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(
          sseBody([
            {
              id: 'e1',
              data: {
                type: 'data-run-start',
                data: { type: 'data-run-start', runId: 'run-y', task: 'x' },
                transient: true,
              },
            },
            {
              id: 'e2',
              data: {
                type: 'data-confirm',
                data: {
                  type: 'data-confirm',
                  promptId: 'p1',
                  kind: 'build',
                  question: 'Create this agent?',
                },
                transient: true,
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-need'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByTestId('wizard-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-prompt')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ promptId: 'p1', value: true });
    vi.unstubAllGlobals();
  });
});
