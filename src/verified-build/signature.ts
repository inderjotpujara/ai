import { z } from 'zod';
import type { AgentProposal, BuilderModel } from '../agent-builder/types.ts';
import type { CrewIR, WorkflowIR } from '../crew-builder/ir.ts';
import type { Shape } from '../crew-builder/types.ts';
import type { CapabilitySignature } from './types.ts';

/** Distill an agent proposal into a comparable capability signature. */
export function signatureFromProposal(p: AgentProposal): CapabilitySignature {
  return {
    purpose: p.description,
    tools: p.suggestedServers.map((s) => s.packName),
    modelTier: '',
    io: '',
    roles: [],
  };
}

function crewTools(ir: CrewIR): string[] {
  const names = new Set<string>();
  for (const member of ir.members) {
    for (const tool of member.tools ?? []) {
      names.add(tool);
    }
  }
  return [...names];
}

function workflowTools(ir: WorkflowIR): string[] {
  const names = new Set<string>();
  for (const step of ir.steps) {
    if (step.kind === 'tool') {
      names.add(step.tool);
    }
    if (step.kind === 'map' && step.step.kind === 'tool') {
      names.add(step.step.tool);
    }
  }
  return [...names];
}

/** Distill a crew/workflow IR into a comparable capability signature. */
export function signatureFromIR(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
): CapabilitySignature {
  if (shape === 'crew') {
    const crew = ir as CrewIR;
    return {
      purpose: crew.description ?? '',
      tools: crewTools(crew),
      modelTier: '',
      io: '',
      roles: crew.members.map((m) => m.role),
    };
  }
  const workflow = ir as WorkflowIR;
  return {
    purpose: workflow.description ?? '',
    tools: workflowTools(workflow),
    modelTier: '',
    io: '',
    roles: workflow.steps.map((s) => s.id),
  };
}

const NeedSignatureSchema = z.object({
  purpose: z.string(),
  tools: z.array(z.string()).optional(),
});

/** Distill a free-text need into a signature via one small structured call. */
export async function signatureFromNeed(
  need: string,
  model: BuilderModel,
): Promise<CapabilitySignature> {
  const prompt = [
    'Distill this need into a capability signature.',
    'purpose: one sentence saying what the capability does.',
    'tools: names of external tools it clearly requires (omit if none).',
    `Need: ${need}`,
  ].join('\n');
  const out = await model.object({ schema: NeedSignatureSchema, prompt });
  return {
    purpose: out.purpose,
    tools: out.tools ?? [],
    modelTier: '',
    io: '',
    roles: [],
  };
}

/** Canonical purpose-forward text form of a signature, used for embedding. */
export function signatureText(s: CapabilitySignature): string {
  return `${s.purpose}\ntools: ${s.tools.join(', ')}\nio: ${s.io}\nroles: ${s.roles.join(', ')}`;
}
