/**
 * Ops telemetry for the privileged device/security routes (Slice 25b): device
 * pairing, revoke, and the break-glass root rotate. Each helper opens and
 * closes a one-shot span carrying ONLY the authorizing principal + the target
 * device id — NEVER a token/secret (the minted token is transmitted exactly
 * once in the pair response, T17, and never touches a span). Like the rest of
 * the telemetry surface these are no-ops without a registered tracer.
 */

import { trace } from '@opentelemetry/api';
import { ATTR } from '../../telemetry/spans.ts';

const tracer = () => trace.getTracer('agent');

/** Record a device pairing (privileged write) as an `ops.devices.pair` span,
 *  carrying the authorizing principal + the NEW device's id. No-op without a
 *  tracer, exactly like the rest of the telemetry surface. */
export function recordDevicePair(deviceId: string, principal: string): void {
  const span = tracer().startSpan('ops.devices.pair');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.setAttribute(ATTR.DEVICE_ID, deviceId);
  span.end();
}

/** Record a device revoke as an `ops.devices.revoke` span, carrying the
 *  authorizing principal + the revoked device's id. */
export function recordDeviceRevoke(deviceId: string, principal: string): void {
  const span = tracer().startSpan('ops.devices.revoke');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.setAttribute(ATTR.DEVICE_ID, deviceId);
  span.end();
}

/** Record a break-glass root rotate as a `security.rotate-root` span, with an
 *  event marking the mass session-invalidation (every OTHER device is logged
 *  out). No target DEVICE_ID — rotate invalidates all sessions at once. */
export function recordRotateRoot(principal: string): void {
  const span = tracer().startSpan('security.rotate-root');
  span.setAttribute(ATTR.SERVER_PRINCIPAL, principal);
  span.addEvent('all-sessions-invalidated');
  span.end();
}
