import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerCreateDialog } from './trigger-create-dialog.tsx';

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function triggerFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'trg-new',
    name: 'nightly-build',
    type: 'cron',
    enabled: true,
    target: { kind: 'workflow', payload: {} },
    config: { schedule: '0 2 * * *' },
    origin: 'console',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** Every test stubs a fetch that ALSO answers the GET `useTriggers` fires on
 *  mount (the dialog owns its own `useTriggers()` instance, the
 *  `PairDeviceDialog` precedent) — `requests` records every call so POST
 *  bodies can be asserted precisely. */
function trackedFetch(onPost?: (body: unknown) => Response) {
  const requests: { method: string; body?: unknown }[] = [];
  const fn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, body });
    if (method === 'POST' && onPost) return onPost(body);
    return jsonResponse({ items: [] }, 200);
  });
  return { fn, requests };
}

describe('TriggerCreateDialog', () => {
  it('renders per-type config fields when switching trigger type', () => {
    const { fn } = trackedFetch();
    vi.stubGlobal('fetch', fn);
    render(<TriggerCreateDialog open onOpenChange={() => {}} />);

    // Cron is the default type.
    expect(screen.getByTestId('trigger-config-cron')).toBeInTheDocument();
    expect(
      screen.queryByTestId('trigger-config-webhook'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('trigger-type'), {
      target: { value: 'webhook' },
    });
    expect(screen.getByTestId('trigger-config-webhook')).toBeInTheDocument();
    expect(screen.queryByTestId('trigger-config-cron')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('trigger-type'), {
      target: { value: 'file' },
    });
    expect(screen.getByTestId('trigger-config-file')).toBeInTheDocument();
    expect(
      screen.queryByTestId('trigger-config-webhook'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('trigger-type'), {
      target: { value: 'jobchain' },
    });
    expect(screen.getByTestId('trigger-config-jobchain')).toBeInTheDocument();
    expect(screen.queryByTestId('trigger-config-file')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('cron create posts the schedule + target and refreshes', async () => {
    const { fn, requests } = trackedFetch(() =>
      jsonResponse({ trigger: triggerFixture() }),
    );
    vi.stubGlobal('fetch', fn);
    const onCreated = vi.fn();
    render(
      <TriggerCreateDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByTestId('trigger-name'), {
      target: { value: 'nightly-build' },
    });
    fireEvent.change(screen.getByTestId('trigger-cron-schedule'), {
      target: { value: '0 2 * * *' },
    });
    fireEvent.change(screen.getByTestId('trigger-target-kind'), {
      target: { value: 'workflow' },
    });
    fireEvent.change(screen.getByTestId('trigger-payload'), {
      target: { value: '{"input":"hi"}' },
    });
    fireEvent.click(screen.getByTestId('trigger-create-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const postReq = requests.find((r) => r.method === 'POST');
    expect(postReq?.body).toEqual({
      name: 'nightly-build',
      type: 'cron',
      target: { kind: 'workflow', payload: { input: 'hi' } },
      config: { schedule: '0 2 * * *', catchUp: false, allowOverlap: false },
    });

    vi.unstubAllGlobals();
  });

  it('webhook create shows the token + /hooks URL exactly once', async () => {
    const { fn } = trackedFetch(() =>
      jsonResponse({
        trigger: triggerFixture({ type: 'webhook', config: { hmac: true } }),
        webhookToken: 'tok-abc123',
        webhookUrl: 'http://127.0.0.1:4130/hooks/tok-abc123',
      }),
    );
    vi.stubGlobal('fetch', fn);
    render(<TriggerCreateDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByTestId('trigger-name'), {
      target: { value: 'ci-hook' },
    });
    fireEvent.change(screen.getByTestId('trigger-type'), {
      target: { value: 'webhook' },
    });
    fireEvent.click(screen.getByTestId('trigger-create-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('trigger-webhook-token')).toHaveValue(
        'tok-abc123',
      ),
    );
    expect(screen.getByTestId('trigger-webhook-url')).toHaveValue(
      'http://127.0.0.1:4130/hooks/tok-abc123',
    );
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();

    // Reopen fresh (dialog close/reopen discards the once-shown token, the
    // PairDeviceDialog precedent).
    fireEvent.click(screen.getByTestId('trigger-create-done'));
    expect(
      screen.queryByTestId('trigger-webhook-token'),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('surfaces a validation error when the payload textarea is not valid JSON', async () => {
    const { fn, requests } = trackedFetch();
    vi.stubGlobal('fetch', fn);
    render(<TriggerCreateDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByTestId('trigger-name'), {
      target: { value: 'bad-payload' },
    });
    fireEvent.change(screen.getByTestId('trigger-cron-schedule'), {
      target: { value: '0 2 * * *' },
    });
    fireEvent.change(screen.getByTestId('trigger-payload'), {
      target: { value: '{not json' },
    });
    fireEvent.click(screen.getByTestId('trigger-create-submit'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/valid json/i),
    );
    expect(requests.some((r) => r.method === 'POST')).toBe(false);

    vi.unstubAllGlobals();
  });
});
