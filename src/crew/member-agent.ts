import type { ToolSet } from 'ai';
import qwenFast from '../../models/qwen-fast.ts';
import type { Agent } from '../core/agent-def.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { CrewMember } from './types.ts';

/** Compose a crew member's role/goal/backstory into an Agent. The model is a
 *  default placeholder; the real model is chosen LIVE by the selector at
 *  delegation (via modelReq + onBeforeDelegate), exactly like the preset agents. */
export function buildCrewAgent(member: CrewMember, tools?: ToolSet): Agent {
  const systemPrompt = [
    `You are ${member.role}.`,
    `Your goal: ${member.goal}`,
    `Background: ${member.backstory}`,
    'Do the task you are given. Use your tools when they help. Return only the result the task asks for — no preamble.',
  ].join('\n');

  return {
    name: member.name,
    description: `${member.role} — ${member.goal}`,
    model: createOllamaModel(qwenFast),
    systemPrompt,
    tools: member.tools ?? tools ?? {},
    modelDecl: qwenFast,
    modelReq: {
      role: member.role,
      requires: member.requires,
      prefer: member.prefer,
    },
  };
}
