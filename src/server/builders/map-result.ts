import type { BuildResult } from '../../agent-builder/types.ts';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import type { CrewBuildResult } from '../../crew-builder/types.ts';

/** Flattens `BuildResult` (`src/agent-builder/types.ts:22-38`) onto the wire
 *  shape (Task 3). `written`'s full `AgentProposal` is JSON-safe (D5) and
 *  structurally satisfies `AgentProposalDtoSchema` field-for-field, so it
 *  rides straight onto `BuildResultDTO.proposal` — this is what lets the
 *  wizard (Task 14) render the D6 post-write proposal DagView without a
 *  second round-trip. */
export function toBuildResultDto(result: BuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.proposal.name,
        files: result.files,
        level: result.level,
        proposal: result.proposal,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return {
        kind: 'reused',
        name: result.name,
        similarity: result.similarity,
      };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}

/** Flattens `CrewBuildResult` (`src/crew-builder/types.ts:13-31`) onto the
 *  same wire shape. Unlike the agent builder, `CrewBuildResult.written` does
 *  NOT carry the committed `CrewIR`/`WorkflowIR` back to the caller (only
 *  `name`/`files`/`builtAgents`) — an existing engine-side gap, not
 *  introduced here. This is why the crew/workflow wizard (Task 14) shows a
 *  plain result card, not a post-write DagView, for `written`: there is no IR
 *  to derive one from without a source change to `crew-builder/types.ts`. */
export function toCrewBuildResultDto(result: CrewBuildResult): BuildResultDTO {
  switch (result.kind) {
    case 'written':
      return {
        kind: 'written',
        name: result.name,
        files: result.files,
        level: result.level,
      };
    case 'declined':
      return { kind: 'declined' };
    case 'invalid':
      return { kind: 'invalid', issues: result.issues };
    case 'abandoned':
      return { kind: 'abandoned', reason: result.reason };
    case 'reused':
      return {
        kind: 'reused',
        name: result.name,
        similarity: result.similarity,
      };
    case 'failed-verification':
      return {
        kind: 'failed-verification',
        stage: result.stage,
        detail: result.detail,
      };
  }
}
