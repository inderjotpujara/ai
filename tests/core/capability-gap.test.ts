import { expect, test } from 'bun:test';
import {
  CAPABILITY_GAP_TOOL,
  capabilityGapTool,
  findCapabilityGap,
} from '../../src/core/capability-gap.ts';

test('tool name and schema are exported', () => {
  expect(CAPABILITY_GAP_TOOL).toBe('report_capability_gap');
  expect(capabilityGapTool).toBeDefined();
});

test('findCapabilityGap extracts the missing capability from a matching tool call', () => {
  const steps = [
    { toolCalls: [{ toolName: 'delegate_to_file_qa', input: { task: 'x' } }] },
    {
      toolCalls: [
        {
          toolName: 'report_capability_gap',
          input: { missingCapability: 'book a flight' },
        },
      ],
    },
  ] as never;
  expect(findCapabilityGap(steps)).toEqual({
    missingCapability: 'book a flight',
  });
});

test('findCapabilityGap returns undefined when no gap was reported', () => {
  const steps = [
    { toolCalls: [{ toolName: 'delegate_to_file_qa', input: { task: 'x' } }] },
  ] as never;
  expect(findCapabilityGap(steps)).toBeUndefined();
});
