import { describe, expect, it } from 'bun:test';
import type { ToolSet } from 'ai';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { createSuperAgent } from '../../agents/super.ts';

describe('agents registry', () => {
  it('registers file_qa, web_fetch, and vision in order', () => {
    expect(agentNames()).toEqual(['file_qa', 'web_fetch', 'vision']);
    expect(typeof AGENTS.file_qa).toBe('function');
    expect(typeof AGENTS.web_fetch).toBe('function');
    expect(typeof AGENTS.vision).toBe('function');
  });
  it('each factory builds an Agent with the expected name', () => {
    const empty: ToolSet = {};
    expect(AGENTS.file_qa?.(empty).name).toBe('file_qa');
    expect(AGENTS.web_fetch?.(empty).name).toBe('web_fetch');
    expect(AGENTS.vision?.(empty).name).toBe('vision');
  });
  it('createSuperAgent builds delegate tools for every registered agent', () => {
    const orch = createSuperAgent(() => ({}), undefined);
    expect(Object.keys(orch.tools)).toContain('delegate_to_file_qa');
    expect(Object.keys(orch.tools)).toContain('delegate_to_web_fetch');
    expect(Object.keys(orch.tools)).toContain('delegate_to_vision');
    expect(Object.keys(orch.tools)).toContain('report_capability_gap');
  });
});
