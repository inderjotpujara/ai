import type {
  CrewDetailDTO,
  CrewListItemDTO,
  CrewMemberDTO,
  CrewTaskDTO,
} from '../contracts/index.ts';
import { CrewProcess } from '../contracts/index.ts';
import type { CrewDef, CrewMember, Task } from './types.ts';

function mapMember(m: CrewMember): CrewMemberDTO {
  return {
    name: m.name,
    role: m.role,
    goal: m.goal,
    backstory: m.backstory,
    // Capability[]/PreferPolicy are string enums — their VALUES are the wire form.
    requires: m.requires.map((c) => String(c)),
    prefer: String(m.prefer),
    ...(m.agentRef !== undefined ? { agentRef: m.agentRef } : {}),
  };
}

function mapTask(t: Task): CrewTaskDTO {
  return {
    id: t.id,
    description: t.description,
    expectedOutput: t.expectedOutput,
    member: t.member,
    dependsOn: t.dependsOn ?? [],
    ...(t.verify !== undefined ? { verify: t.verify } : {}),
  };
}

/** Contract enum values equal engine enum values (parity-tested), so a direct
 *  cast is safe; keep it explicit rather than importing the engine enum. */
export function mapCrewToListItem(def: CrewDef): CrewListItemDTO {
  return {
    name: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    process: def.process as unknown as CrewProcess,
    memberCount: def.members.length,
    taskCount: def.tasks.length,
  };
}

export function mapCrewToDetail(def: CrewDef): CrewDetailDTO {
  return {
    name: def.id,
    ...(def.description !== undefined ? { description: def.description } : {}),
    process: def.process as unknown as CrewProcess,
    members: def.members.map(mapMember),
    tasks: def.tasks.map(mapTask),
  };
}
