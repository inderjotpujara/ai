// src/cli/offer-crew.ts

/** Multi-step signal words: sequencing (then/after that), plural steps, or
 *  multi-agent shapes (workflow/team/crew/pipeline). A gap description
 *  matching this heuristic is offered the crew/workflow-builder instead of
 *  (before) the single-agent builder. */
const MULTI_STEP_SIGNAL =
  /\b(then|after that|steps?|workflow|team|crew|pipeline)\b/i;

/** True when the described capability gap looks like it needs multiple
 *  coordinated steps/roles rather than a single agent. */
export function shouldOfferCrew(text: string): boolean {
  return MULTI_STEP_SIGNAL.test(text);
}
