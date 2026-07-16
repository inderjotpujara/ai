import { expect, test } from 'bun:test';
import { RunKind } from '../../src/contracts/enums.ts';
import { deriveRunKind } from '../../src/run/run-dto.ts';

test('deriveRunKind maps root span names to a RunKind', () => {
  expect(deriveRunKind(['crew.run'])).toBe(RunKind.Crew);
  expect(deriveRunKind(['workflow.run'])).toBe(RunKind.Workflow);
  expect(deriveRunKind(['agent.run'])).toBe(RunKind.Agent);
  expect(deriveRunKind([])).toBe(RunKind.Chat); // ui.stream / no recognized root
  expect(deriveRunKind(['ui.stream'])).toBe(RunKind.Chat);
});

test('deriveRunKind maps build/pull roots to RunKind.Build/RunKind.Pull (Phase 5)', () => {
  expect(deriveRunKind(['agent.build'])).toBe(RunKind.Build);
  expect(deriveRunKind(['crew.build'])).toBe(RunKind.Build);
  expect(deriveRunKind(['model.pull'])).toBe(RunKind.Pull);
});

test('deriveRunKind maps mcp.mount/memory.* roots to RunKind.Mcp/RunKind.Memory (Phase 5 final review)', () => {
  expect(deriveRunKind(['mcp.mount'])).toBe(RunKind.Mcp);
  expect(deriveRunKind(['memory.recall'])).toBe(RunKind.Memory);
  expect(deriveRunKind(['memory.ingest'])).toBe(RunKind.Memory);
});
