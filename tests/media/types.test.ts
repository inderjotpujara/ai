import { expect, test } from 'bun:test';
import { ExecMode, JobStatus, MediaKind } from '../../src/media/types.ts';

test('media kinds and job statuses are declared', () => {
  // bun:test's generic toBe() infers the enum type for `expected`; cast to string to compare the runtime literal value.
  expect(MediaKind.Image as string).toBe('image');
  expect(MediaKind.Audio as string).toBe('audio');
  expect(MediaKind.Video as string).toBe('video');
  expect(JobStatus.Completed as string).toBe('completed');
});

test('exec modes are declared', () => {
  expect(ExecMode.OneShot as string).toBe('one_shot');
  expect(ExecMode.Server as string).toBe('server');
});
