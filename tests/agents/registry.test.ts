import { describe, expect, it } from 'bun:test';
import type { ToolSet } from 'ai';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { createSuperAgent } from '../../agents/super.ts';

describe('agents registry', () => {
  it('registers file_qa, web_fetch, vision, and media_creator in order', () => {
    expect(agentNames()).toEqual([
      'file_qa',
      'web_fetch',
      'vision',
      'media_creator',
    ]);
    expect(typeof AGENTS.file_qa).toBe('function');
    expect(typeof AGENTS.web_fetch).toBe('function');
    expect(typeof AGENTS.vision).toBe('function');
    expect(typeof AGENTS.media_creator).toBe('function');
  });
  it('each factory builds an Agent with the expected name', () => {
    const empty: ToolSet = {};
    expect(AGENTS.file_qa?.(empty).name).toBe('file_qa');
    expect(AGENTS.web_fetch?.(empty).name).toBe('web_fetch');
    expect(AGENTS.vision?.(empty).name).toBe('vision');
    expect(AGENTS.media_creator?.(empty).name).toBe('media_creator');
  });
  it('createSuperAgent builds delegate tools for every registered agent', () => {
    const orch = createSuperAgent(() => ({}), undefined);
    expect(Object.keys(orch.tools)).toContain('delegate_to_file_qa');
    expect(Object.keys(orch.tools)).toContain('delegate_to_web_fetch');
    expect(Object.keys(orch.tools)).toContain('delegate_to_vision');
    expect(Object.keys(orch.tools)).toContain('delegate_to_media_creator');
    expect(Object.keys(orch.tools)).toContain('report_capability_gap');
  });
});
