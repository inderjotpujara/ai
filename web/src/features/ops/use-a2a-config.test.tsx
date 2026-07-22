import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useA2aConfig } from './use-a2a-config.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const CONFIG_BODY = {
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
};

function ConfigProbe() {
  const { config, issueToken } = useA2aConfig();
  return (
    <div>
      <div data-testid="count">
        {config ? String(config.tokens.length) : 'loading'}
      </div>
      <button type="button" onClick={() => void issueToken('laptop')}>
        issue
      </button>
    </div>
  );
}

describe('useA2aConfig', () => {
  it('loads config and refetches after issueToken', async () => {
    let getCalls = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/a2a/token') && init?.method === 'POST') {
          return jsonResponse({ id: 'tok1', token: 'raw-secret-once' });
        }
        getCalls += 1;
        return jsonResponse({
          ...CONFIG_BODY,
          tokens:
            getCalls > 1 ? [{ id: 'tok1', label: 'laptop', createdAt: 1 }] : [],
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConfigProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('0'),
    );

    screen.getByRole('button', { name: 'issue' }).click();

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    expect(getCalls).toBe(2);
    vi.unstubAllGlobals();
  });
});
