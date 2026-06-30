import { afterEach, expect, test } from 'bun:test';
import {
  type KvArch, KvCacheType, activeKvCacheType, effectiveKvBytesPerToken,
  f16KvBytesPerToken, isKvQuantRisky, kvCacheMultiplier,
} from '../../src/resource/kv-cache.ts';

afterEach(() => { delete process.env.AGENT_KV_CACHE_TYPE; });

test('multipliers', () => {
  expect(kvCacheMultiplier(KvCacheType.F16)).toBe(1.0);
  expect(kvCacheMultiplier(KvCacheType.Q8_0)).toBe(0.5);
  expect(kvCacheMultiplier(KvCacheType.Q4_0)).toBe(0.25);
});
test('activeKvCacheType: default q8_0, honors valid, garbage→q8_0', () => {
  expect(activeKvCacheType()).toBe(KvCacheType.Q8_0);
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  expect(activeKvCacheType()).toBe(KvCacheType.F16);
  process.env.AGENT_KV_CACHE_TYPE = 'nonsense';
  expect(activeKvCacheType()).toBe(KvCacheType.Q8_0);
});
test('f16KvBytesPerToken from arch; high-GQA is many-fold smaller', () => {
  const bigKv: KvArch = { blockCount: 32, headCountKv: 32, keyLength: 128, valueLength: 128, expertCount: 0 };
  const gqaKv: KvArch = { blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 };
  expect(f16KvBytesPerToken(bigKv)).toBe(32 * 32 * 256 * 2);
  expect(f16KvBytesPerToken(gqaKv)).toBe(32 * 8 * 256 * 2);
  expect(f16KvBytesPerToken(bigKv) / f16KvBytesPerToken(gqaKv)).toBe(4); // many-fold spread
});
test('effectiveKvBytesPerToken applies active multiplier', () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  expect(effectiveKvBytesPerToken(131072)).toBe(65536);
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  expect(effectiveKvBytesPerToken(131072)).toBe(131072);
});
test('isKvQuantRisky: arch-derived, no family names', () => {
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 64, valueLength: 64, expertCount: 0 })).toBe(true); // small head_dim
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 8 })).toBe(true); // MoE
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 })).toBe(false);
});
