import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { AddRemoteDialog } from './add-remote-dialog.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DISCOVERED_CARD = {
  name: 'peer-agent',
  description: 'a remote peer',
  version: '1.0.0',
  protocolVersion: '1.0',
  url: 'http://peer.example/a2a',
  preferredTransport: 'JSONRPC',
  skills: [],
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  securitySchemes: {},
  security: [],
};

describe('AddRemoteDialog', () => {
  it('dry-runs test then persists on confirm', async () => {
    const testRemote = vi.fn().mockResolvedValue({
      card: DISCOVERED_CARD,
      pinnedCardHash: 'deadbeefcafefeed',
    });
    const addRemote = vi.fn().mockResolvedValue({});
    const onOpenChange = vi.fn();

    render(
      <AddRemoteDialog
        open
        onOpenChange={onOpenChange}
        testRemote={testRemote}
        addRemote={addRemote}
      />,
    );

    fireEvent.change(screen.getByTestId('add-remote-name'), {
      target: { value: 'peer-agent' },
    });
    fireEvent.change(screen.getByTestId('add-remote-card-url'), {
      target: { value: 'http://peer.example/.well-known/agent-card.json' },
    });
    fireEvent.change(screen.getByTestId('add-remote-token'), {
      target: { value: 'peer-bearer-token' },
    });

    // Confirm is locked until a test has run for this exact URL.
    expect(screen.getByTestId('add-remote-confirm')).toBeDisabled();

    fireEvent.click(screen.getByTestId('add-remote-test'));
    await waitFor(() =>
      expect(testRemote).toHaveBeenCalledWith({
        cardUrl: 'http://peer.example/.well-known/agent-card.json',
      }),
    );

    // The dry-run shows the discovered card preview + pin — nothing
    // persisted yet.
    expect(await screen.findByTestId('add-remote-preview')).toBeInTheDocument();
    expect(screen.getByText(/peer-agent/)).toBeInTheDocument();
    expect(screen.getByText(/deadbeefcafefeed/)).toBeInTheDocument();
    expect(addRemote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('add-remote-confirm'));
    await waitFor(() =>
      expect(addRemote).toHaveBeenCalledWith({
        name: 'peer-agent',
        cardUrl: 'http://peer.example/.well-known/agent-card.json',
        token: 'peer-bearer-token',
      }),
    );

    // Dry-run-before-persist: test must have been called strictly before
    // addRemote, never the reverse.
    const testedAt = testRemote.mock.invocationCallOrder.at(0) ?? -1;
    const addedAt = addRemote.mock.invocationCallOrder.at(0) ?? -1;
    expect(testedAt).toBeGreaterThanOrEqual(0);
    expect(testedAt).toBeLessThan(addedAt);

    // A successful add closes the dialog.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('re-locks Confirm if the card URL changes after a successful test', async () => {
    const testRemote = vi.fn().mockResolvedValue({
      card: DISCOVERED_CARD,
      pinnedCardHash: 'deadbeefcafefeed',
    });
    const addRemote = vi.fn().mockResolvedValue({});

    render(
      <AddRemoteDialog
        open
        onOpenChange={() => {}}
        testRemote={testRemote}
        addRemote={addRemote}
      />,
    );

    fireEvent.change(screen.getByTestId('add-remote-name'), {
      target: { value: 'peer-agent' },
    });
    fireEvent.change(screen.getByTestId('add-remote-card-url'), {
      target: { value: 'http://peer.example/.well-known/agent-card.json' },
    });
    fireEvent.change(screen.getByTestId('add-remote-token'), {
      target: { value: 'peer-bearer-token' },
    });
    fireEvent.click(screen.getByTestId('add-remote-test'));
    await screen.findByTestId('add-remote-preview');

    // Editing the URL invalidates the stale preview/pin.
    fireEvent.change(screen.getByTestId('add-remote-card-url'), {
      target: { value: 'http://peer.example/other-card.json' },
    });
    expect(screen.queryByTestId('add-remote-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-remote-confirm')).toBeDisabled();
  });
});

describe('Federation Consume panel', () => {
  const REMOTE = {
    name: 'peer-1',
    baseUrl: 'http://peer1.example/a2a',
    cardUrl: 'http://peer1.example/.well-known/agent-card.json',
    pinnedCardHash: 'abc123def456abc123def456',
  };

  const RUN = {
    id: 'run-xyz',
    kind: 'agent',
    startMs: 1000,
    durationMs: 42,
    outcome: 'answer',
    lifecycle: 'done',
    origin: 'remote',
    models: ['qwen'],
    degraded: false,
    spanCount: 3,
  };

  function mockFetch() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.endsWith('/api/a2a/config') && method === 'GET') {
        return jsonResponse({
          enabled: true,
          skills: [],
          cardPreview: {
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
          },
          tokens: [],
        });
      }
      if (url.endsWith('/api/a2a/remotes') && method === 'GET') {
        return jsonResponse({ remotes: [REMOTE] });
      }
      if (url.includes('/api/a2a/remotes/') && method === 'DELETE') {
        return jsonResponse({ removed: true });
      }
      if (url.includes('/api/runs') && method === 'GET') {
        return jsonResponse({ items: [RUN], total: 1 });
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    });
  }

  it('lists remotes and deep-links a remote task to /runs/:id', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops?tab=federation');

    expect(await screen.findByTestId('ops-a2a-remotes')).toBeInTheDocument();
    expect(screen.getByTestId('ops-a2a-remote-row-peer-1')).toBeInTheDocument();
    expect(screen.getByText(/peer-1/)).toBeInTheDocument();

    // The remote task list has a working Link to /runs/<id> — the
    // Jobs-tab precedent (`job-detail-drawer.tsx`), no new viewer.
    const link = await screen.findByRole('link', { name: /run-xyz/ });
    expect(link).toHaveAttribute('href', '/runs/run-xyz');

    vi.unstubAllGlobals();
  });

  it('removing a remote calls removeRemote', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=federation');

    await screen.findByTestId('ops-a2a-remote-row-peer-1');
    fireEvent.click(screen.getByTestId('ops-a2a-remote-remove-peer-1'));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
      expect(String(deleteCall?.[0])).toContain('/api/a2a/remotes/peer-1');
    });

    vi.unstubAllGlobals();
  });
});
