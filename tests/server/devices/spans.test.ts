import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  recordDevicePair,
  recordDeviceRevoke,
  recordRotateRoot,
} from '../../../src/server/devices/spans.ts';
import { registerTestProvider } from '../../helpers/otel-test-provider.ts';

// No-tracer path: the helpers must be callable no-ops (never throw) when no
// SDK provider is registered — the same "no-op without a tracer" contract the
// rest of the telemetry surface upholds.
test('device/rotate span helpers are no-ops without a tracer (never throw)', () => {
  expect(() => recordDevicePair('d1', 'local')).not.toThrow();
  expect(() => recordDeviceRevoke('d1', 'local')).not.toThrow();
  expect(() => recordRotateRoot('local')).not.toThrow();
});

// With a provider registered, the helpers emit the expected spans carrying only
// the authorizing principal + the target deviceId — and NEVER any token/secret.
let h: ReturnType<typeof registerTestProvider>;
beforeAll(() => {
  h = registerTestProvider();
});
afterAll(() => h.provider.shutdown());

test('recordDevicePair emits ops.devices.pair with principal + device.id, no secret', () => {
  recordDevicePair('dev-abc', 'local');
  const span = h.exporter
    .getFinishedSpans()
    .find(
      (s) =>
        s.name === 'ops.devices.pair' &&
        s.attributes['device.id'] === 'dev-abc',
    );
  expect(span).toBeDefined();
  expect(span?.attributes['server.principal']).toBe('local');
  expect(span?.attributes['device.id']).toBe('dev-abc');
  // Security: the span must carry no token/secret material — only ids/principal.
  for (const key of Object.keys(span?.attributes ?? {})) {
    expect(key).not.toContain('token');
    expect(key).not.toContain('secret');
  }
});

test('recordDeviceRevoke emits ops.devices.revoke with principal + device.id', () => {
  recordDeviceRevoke('dev-xyz', 'local');
  const span = h.exporter
    .getFinishedSpans()
    .find(
      (s) =>
        s.name === 'ops.devices.revoke' &&
        s.attributes['device.id'] === 'dev-xyz',
    );
  expect(span).toBeDefined();
  expect(span?.attributes['server.principal']).toBe('local');
});

test('recordRotateRoot emits security.rotate-root with principal + mass-invalidation event, no device.id', () => {
  recordRotateRoot('local');
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'security.rotate-root');
  expect(span).toBeDefined();
  expect(span?.attributes['server.principal']).toBe('local');
  // Rotate invalidates ALL sessions at once — it targets no single device.
  expect(span?.attributes['device.id']).toBeUndefined();
  expect(span?.events.some((e) => e.name === 'all-sessions-invalidated')).toBe(
    true,
  );
});
