import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE_CARD_PREVIEW = {
  name: 'agent',
  description: 'desc',
  version: '1.0.0',
  protocolVersion: '1.0',
  url: 'http://localhost/a2a',
  preferredTransport: 'JSONRPC',
  skills: [],
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  securitySchemes: {},
  security: [],
};

function configBody(overrides?: {
  skills?: unknown[];
  tokens?: unknown[];
}): unknown {
  return {
    enabled: true,
    skills: overrides?.skills ?? [],
    cardPreview: BASE_CARD_PREVIEW,
    tokens: overrides?.tokens ?? [],
  };
}

/** URL-routing mock covering every `/api/a2a/*` route the Expose panel
 *  touches. Any other Ops-tab endpoint (daemon/status, queue/stats, jobs,
 *  …) is left unmocked — it rejects, and every consuming hook already
 *  absorbs a failed fetch into its own `error` state (`use-daemon-status.ts`
 *  et al.), so switching tabs during a test never crashes, it just leaves
 *  those OTHER cards in their error state. */
function mockFetch(opts?: { config?: unknown; skillsPutStatus?: number }) {
  let tokenSeq = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/a2a/config') && method === 'GET') {
      return jsonResponse(opts?.config ?? configBody());
    }
    if (url.endsWith('/api/a2a/skills') && method === 'PUT') {
      if (opts?.skillsPutStatus && opts.skillsPutStatus >= 400) {
        return jsonResponse(
          { error: 'unknown skill ref' },
          opts.skillsPutStatus,
        );
      }
      return jsonResponse({});
    }
    if (url.endsWith('/api/a2a/token') && method === 'POST') {
      tokenSeq += 1;
      return jsonResponse({
        id: `tok${tokenSeq}`,
        token: `secret-${tokenSeq}`,
      });
    }
    if (url.includes('/api/a2a/token/') && method === 'DELETE') {
      return jsonResponse({});
    }
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
}

describe('FederationTab', () => {
  it('renders the Expose panel (data-testid ops-federation) with a live card preview', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops?tab=federation');

    expect(await screen.findByTestId('ops-federation')).toBeInTheDocument();
    expect(await screen.findByTestId('a2a-card-preview')).toBeInTheDocument();
    expect(screen.getByTestId('a2a-card-name')).toHaveTextContent('agent');
    expect(screen.getByTestId('a2a-card-url')).toHaveTextContent(
      'http://localhost/a2a',
    );

    vi.unstubAllGlobals();
  });

  it('issuing a token shows the secret exactly once, then it is gone on refresh', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops?tab=federation');
    await screen.findByTestId('ops-federation');

    fireEvent.change(screen.getByTestId('a2a-token-label'), {
      target: { value: 'peer-agent' },
    });
    fireEvent.click(screen.getByTestId('a2a-token-issue-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('a2a-token-secret')).toHaveValue('secret-1'),
    );

    // Switch away and back — the Federation panel unmounts/remounts (the
    // OpsArea only renders the active tab's panel), and the server never
    // re-lists the raw secret (`GET /api/a2a/config` returns token METADATA
    // only). Mirrors `PairDeviceDialog`'s close/reopen "shown once" test.
    fireEvent.click(screen.getByTestId('ops-tab-overview'));
    await waitFor(() =>
      expect(screen.queryByTestId('ops-federation')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('ops-tab-federation'));
    await screen.findByTestId('ops-federation');

    expect(screen.queryByTestId('a2a-token-secret')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders a malicious skill name as inert text, never as markup', async () => {
    const xssName = '<img src=x onerror="alert(1)">';
    vi.stubGlobal(
      'fetch',
      mockFetch({
        config: configBody({
          skills: [
            {
              skillId: 'xss-1',
              name: xssName,
              description: 'desc',
              kind: 'chat',
              ref: 'some/ref',
            },
          ],
        }),
      }),
    );
    renderAt('/ops?tab=federation');

    await waitFor(() =>
      expect(screen.getByTestId('a2a-skill-row-0')).toBeInTheDocument(),
    );

    // The name renders as literal text (React escapes it) — no <img>
    // element is created in the DOM, so there is no onerror handler to fire.
    expect(screen.getByText(xssName)).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('surfaces a bad-ref 400 from PUT /api/a2a/skills to the operator', async () => {
    vi.stubGlobal('fetch', mockFetch({ skillsPutStatus: 400 }));
    renderAt('/ops?tab=federation');
    await screen.findByTestId('a2a-skill-allowlist');

    fireEvent.click(screen.getByTestId('a2a-skill-add'));
    fireEvent.change(screen.getByTestId('a2a-skill-ref-0'), {
      target: { value: 'not-a-real-ref' },
    });
    fireEvent.click(screen.getByTestId('a2a-skill-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});
