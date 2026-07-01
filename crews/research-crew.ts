import { z } from 'zod';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { defineCrew } from '../src/crew/define.ts';
import { CrewProcess } from '../src/crew/types.ts';

/** A sequential research crew: researcher gathers, writer summarizes.
 *  Crew input is the topic/URL. */
export default defineCrew({
  id: 'research-crew',
  description: 'Research a topic and produce a short brief.',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'Gather accurate, relevant facts on the given topic',
      backstory: 'You are meticulous and cite what you find.',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    {
      name: 'writer',
      role: 'Technical Writer',
      goal: 'Turn research notes into a clear 3-bullet brief',
      backstory: 'You write tight, plain summaries.',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  ],
  tasks: [
    {
      id: 'gather',
      description:
        'Research the topic given as input and produce concise notes.',
      expectedOutput: 'A short list of key facts.',
      member: 'researcher',
      output: z.string(),
    },
    {
      id: 'brief',
      description: 'Using the research notes, write a 3-bullet brief.',
      expectedOutput: 'Exactly 3 bullet points.',
      member: 'writer',
      dependsOn: ['gather'],
      output: z.string(),
    },
  ],
});
