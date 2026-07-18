import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import {
  isOsNotifyEnabled,
  isVoiceInputEnabled,
  voiceModelTier,
} from './index.tsx';

function stubNotification(
  permission: NotificationPermission,
  requestResult: NotificationPermission = permission,
) {
  const NotificationMock = {
    permission,
    requestPermission: vi.fn().mockResolvedValue(requestResult),
  };
  vi.stubGlobal('Notification', NotificationMock);
  return NotificationMock;
}

describe('SettingsArea', () => {
  afterEach(() => {
    // Order matters: `localStorage` here is itself a `vi.stubGlobal` mock
    // (installed by the shared test setup's `beforeEach`, see
    // `src/test/setup.ts`) — clear it BEFORE `unstubAllGlobals()` removes
    // the stub, or `.clear()` would hit the real (broken-in-this-env) global.
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the "Enable OS notifications" toggle, initially off', async () => {
    stubNotification('default');
    renderAt('/settings');
    expect(await screen.findByTestId('notify-os-toggle')).toHaveTextContent(
      'Enable OS notifications',
    );
    expect(isOsNotifyEnabled()).toBe(false);
  });

  it('requests permission and turns on when granted', async () => {
    const mock = stubNotification('default', 'granted');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(mock.requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('OS notifications: on')).toBeInTheDocument();
    expect(isOsNotifyEnabled()).toBe(true);
  });

  it('stays off when permission is denied', async () => {
    stubNotification('default', 'denied');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(
      await screen.findByText('Enable OS notifications'),
    ).toBeInTheDocument();
    expect(isOsNotifyEnabled()).toBe(false);
  });

  it('toggles back off when clicked again while already on', async () => {
    stubNotification('granted', 'granted');
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('notify-os-toggle'));
    expect(await screen.findByText('OS notifications: on')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notify-os-toggle'));
    expect(
      await screen.findByText('Enable OS notifications'),
    ).toBeInTheDocument();
  });
});

describe('SettingsArea — voice input', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the voice-input toggle, initially off, defaulting the model tier to moonshine-base', async () => {
    renderAt('/settings');
    expect(await screen.findByTestId('voice-input-toggle')).toHaveTextContent(
      'Enable voice input',
    );
    expect(isVoiceInputEnabled()).toBe(false);
    expect(voiceModelTier()).toBe('moonshine-base');
  });

  it('turns voice input on when clicked and persists the choice', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(true);
  });

  it('toggles voice input back off when clicked again while already on', async () => {
    renderAt('/settings');
    fireEvent.click(await screen.findByTestId('voice-input-toggle'));
    expect(await screen.findByText('Voice input: on')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-input-toggle'));
    expect(await screen.findByText('Enable voice input')).toBeInTheDocument();
    expect(isVoiceInputEnabled()).toBe(false);
  });

  it('changes and persists the model tier selection', async () => {
    renderAt('/settings');
    const select = await screen.findByTestId('voice-model-tier');
    fireEvent.change(select, { target: { value: 'moonshine-tiny' } });
    expect(voiceModelTier()).toBe('moonshine-tiny');
  });
});
