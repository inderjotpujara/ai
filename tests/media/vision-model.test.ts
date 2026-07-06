import { expect, test } from 'bun:test';
import qwenVision from '../../models/qwen-vision.ts';
import { BOOTSTRAP } from '../../models/registry.ts';
import { Capability } from '../../src/core/types.ts';
import snapshot from '../../src/provisioning/catalog/snapshot.json' with {
  type: 'json',
};

type SnapshotEntry = {
  provider: string;
  model: string;
  repo: string;
  params_billions: number;
  bytes_per_weight: number;
  file_size_bytes: number;
  downloads: number;
  role: string;
  capabilities: string[];
};

test('vision model advertises Vision and is in BOOTSTRAP', () => {
  expect(qwenVision.model).toBe('qwen2.5vl:7b');
  expect(qwenVision.capabilities).toContain(Capability.Vision);
  expect(BOOTSTRAP).toContain(qwenVision);
});

test('vision model catalog entry uses correct provider casing', () => {
  const visionEntry = (snapshot as SnapshotEntry[]).find(
    (entry: SnapshotEntry) => entry.model === 'qwen2.5vl:7b',
  );
  expect(visionEntry).toBeDefined();
  expect(visionEntry?.provider).toBe('Ollama');
});
