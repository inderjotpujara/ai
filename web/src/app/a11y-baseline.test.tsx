import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { renderAt } from '../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const emptyList = { items: [], total: 0 };

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
    stop: vi.fn(),
  }),
}));

describe("a11y baseline (vitest-axe, D4) — no violations on the app's key screens", () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(emptyList)),
    );
  });

  it('Chat (/)', async () => {
    const { container } = renderAt('/');
    await waitFor(() => screen.getByTestId('area-chat'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Sessions (/sessions)', async () => {
    const { container } = renderAt('/sessions');
    await waitFor(() => screen.getByTestId('area-sessions'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Runs (/runs)', async () => {
    const { container } = renderAt('/runs');
    await waitFor(() => screen.getByTestId('area-runs'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Library (/library)', async () => {
    const { container } = renderAt('/library');
    await waitFor(() => screen.getByTestId('area-library'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Builders (/builders)', async () => {
    const { container } = renderAt('/builders');
    await waitFor(() => screen.getByTestId('area-builders'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Settings (/settings)', async () => {
    const { container } = renderAt('/settings');
    await waitFor(() => screen.getByTestId('area-settings'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
