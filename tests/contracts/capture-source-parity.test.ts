import { expect, test } from 'bun:test';
import { CaptureSource as ContractCaptureSource } from '../../src/contracts/enums.ts';
import { CaptureSource as VoiceCaptureSource } from '../../src/voice/types.ts';

test('contract CaptureSource values stay isomorphic with voice (single-sourced post-lift, D5)', () => {
  expect(Object.values(ContractCaptureSource).sort()).toEqual(
    Object.values(VoiceCaptureSource).sort(),
  );
});
