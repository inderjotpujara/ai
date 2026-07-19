import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelemetry } from './beacon.ts';

const event = {
  kind: 'voice.transcribe.web',
  durationMs: 900,
  wordCount: 5,
  modelTier: 'moonshine-base',
  realTimeFactor: 0.3,
  engine: 'transformers.js',
} as const;

describe('sendTelemetry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts a JSON blob to /api/telemetry (NO ?k=) with the token + event in the BODY', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('window', { __AGENT_TOKEN__: 'tok-42' });
    sendTelemetry(event);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: mock.calls[0] is guaranteed present — we just asserted the one call
    const [url, blob] = sendBeacon.mock.calls[0]!;
    // The token must NOT ride the URL (no history/proxy-log leak).
    expect(url).toBe('/api/telemetry');
    expect((blob as Blob).type).toBe('application/json');
    const parsed = JSON.parse(await (blob as Blob).text());
    expect(parsed).toEqual({ token: 'tok-42', event });
  });

  it('is a silent no-op when navigator.sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(() => sendTelemetry(event)).not.toThrow();
  });
});
