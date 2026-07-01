import type { ToolSet } from 'ai';
import type { z } from 'zod';
import type {
  Capability,
  ModelDeclaration,
  PreferPolicy,
} from '../core/types.ts';

/** A role-bearing team member. role/goal/backstory are prompt scaffolding;
 *  the concrete model is resolved live by the selector from requires/prefer. */
export type CrewMember = {
  name: string; // stable id; used as the agent name + delegate tool name
  role: string; // e.g. "Senior Research Analyst"
  goal: string; // the member's individual objective
  backstory: string; // persona/context that enriches its prompt
  requires: Capability[]; // capability hard-filter for live model selection
  prefer: PreferPolicy; // soft rank over survivors
  tools?: ToolSet; // optional tools this member can call
};

/** A unit of work assigned to a member. expectedOutput is prompt guidance;
 *  output (optional) is the enforced zod schema for typed hand-offs. */
export type Task<O = unknown> = {
  id: string;
  description: string; // what to do (prompt)
  expectedOutput: string; // what good output looks like (prompt guidance)
  member: string; // CrewMember.name that runs this task
  dependsOn?: string[]; // upstream task ids whose outputs are context
  output?: z.ZodType<O>; // optional structured output; validated if present
};

export enum CrewProcess {
  Sequential = 'sequential',
  Hierarchical = 'hierarchical',
}

export type CrewDef = {
  id: string;
  description?: string;
  members: CrewMember[];
  tasks: Task[];
  process: CrewProcess;
  managerModel?: ModelDeclaration; // hierarchical only; defaults to the router
};

export type CrewOutcome =
  | { kind: 'done'; output: unknown }
  | { kind: 'failed'; failedTask?: string; message: string };
