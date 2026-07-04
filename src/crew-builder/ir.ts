import { z } from 'zod';

/** How a step/task input closure is produced (JSON-safe descriptor, not a closure). */
export const InputDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fromInput') }),
  z.object({ kind: z.literal('fromStep'), ref: z.string().min(1) }),
  z.object({ kind: z.literal('fromTemplate'), template: z.string().min(1) }),
]);
export type InputDescriptor = z.infer<typeof InputDescriptorSchema>;

/** How a branch predicate closure is produced. */
export const PredicateDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('whenEquals'),
    ref: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('whenContains'),
    ref: z.string().min(1),
    substr: z.string().min(1),
  }),
  z.object({ kind: z.literal('whenTruthy'), ref: z.string().min(1) }),
]);
export type PredicateDescriptor = z.infer<typeof PredicateDescriptorSchema>;

const AgentStepIR = z.object({
  kind: z.literal('agent'),
  id: z.string().min(1),
  agent: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  input: InputDescriptorSchema,
  verify: z.boolean().optional(),
});
const ToolStepIR = z.object({
  kind: z.literal('tool'),
  id: z.string().min(1),
  tool: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  input: InputDescriptorSchema,
});
const BranchStepIR = z.object({
  kind: z.literal('branch'),
  id: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  predicate: PredicateDescriptorSchema,
  whenTrue: z.string().min(1),
  whenFalse: z.string().min(1),
});
const MapSubStepIR = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agent: z.string().min(1),
    input: InputDescriptorSchema,
  }),
  z.object({
    kind: z.literal('tool'),
    tool: z.string().min(1),
    input: InputDescriptorSchema,
  }),
]);
const MapStepIR = z.object({
  kind: z.literal('map'),
  id: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  over: z.object({ kind: z.literal('mapOver'), ref: z.string().min(1) }),
  step: MapSubStepIR,
});

export const WorkflowStepIRSchema = z.discriminatedUnion('kind', [
  AgentStepIR,
  ToolStepIR,
  BranchStepIR,
  MapStepIR,
]);
export type WorkflowStepIR = z.infer<typeof WorkflowStepIRSchema>;

export const WorkflowIRSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(WorkflowStepIRSchema).min(1),
});
export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;

export const CrewMemberIRSchema = z.object({
  name: z.string().min(1),
  agentRef: z.string().optional(), // registered AGENTS name to reuse; absent = inline member
  role: z.string().min(1),
  goal: z.string().min(1),
  backstory: z.string().min(1),
  requires: z.array(z.string()).min(1),
  tools: z.array(z.string()).optional(),
});
export type CrewMemberIR = z.infer<typeof CrewMemberIRSchema>;

export const CrewTaskIRSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  expectedOutput: z.string().min(1),
  member: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
});

export const CrewIRSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  process: z.enum(['sequential', 'hierarchical']),
  members: z.array(CrewMemberIRSchema).min(1),
  tasks: z.array(CrewTaskIRSchema).min(1),
});
export type CrewIR = z.infer<typeof CrewIRSchema>;
