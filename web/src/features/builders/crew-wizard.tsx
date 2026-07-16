import { BuilderKind } from '@contracts';
import { BuilderWizard } from './builder-wizard.tsx';

/** `kind: BuilderKind.Crew` is a nominal request label — `buildCrewOrWorkflow`'s
 *  own `classifyNeed()` decides crew vs. workflow SHAPE from the need text
 *  itself (`src/crew-builder/builder.ts`); `createRealRunBuilderTurn` (Task
 *  12) dispatches identically for `BuilderKind.Crew`/`BuilderKind.Workflow`
 *  (anything not `Agent` goes to `makeRealCrewBuilderDeps`). This wizard
 *  covers both shapes under one flow, matching the engine's own design. */
export function CrewWizard() {
  return (
    <BuilderWizard kind={BuilderKind.Crew} title="Crew / Workflow Builder" />
  );
}
