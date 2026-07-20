import { expect, test } from 'bun:test';
import { DeviceListResponseSchema } from '../../src/contracts/dto.ts';
import { DevicePairRequestSchema } from '../../src/contracts/requests.ts';

test('DeviceListResponse round-trips a device row', () => {
  const r = DeviceListResponseSchema.parse({
    items: [{ deviceId: 'd1', label: 'phone', createdAt: 1, exp: 2 }],
  });
  expect(r.items[0]?.label).toBe('phone');
});
test('DevicePairRequest rejects an empty label and caps at 120 chars', () => {
  expect(() => DevicePairRequestSchema.parse({ label: '' })).toThrow();
  expect(() =>
    DevicePairRequestSchema.parse({ label: 'x'.repeat(121) }),
  ).toThrow();
  expect(DevicePairRequestSchema.parse({ label: 'ok' }).label).toBe('ok');
});
