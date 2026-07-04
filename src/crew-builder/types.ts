// src/crew-builder/types.ts
import type {
  BuilderDeps,
  BuilderModel,
  ValidationIssue,
} from '../agent-builder/types.ts';
import type { WritePaths } from '../agent-builder/write.ts';
import type { VerifiedLevel } from '../verified-build/types.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';

export type Shape = 'crew' | 'workflow';

export type CrewBuildResult =
  | {
      kind: 'written';
      shape: Shape;
      name: string;
      files: string[];
      builtAgents: string[];
      level?: VerifiedLevel;
    }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'abandoned'; reason: string }
  /** Reuse-check hit an existing crew/workflow close enough in capability —
   *  nothing was generated. */
  | { kind: 'reused'; name: string; similarity: number }
  /** Consent was granted and the IR was staged, but it failed the
   *  verify-then-commit gate (structural / dry-run / golden-eval) and
   *  `deps.verify.force` was not set — nothing was registered. */
  | { kind: 'failed-verification'; stage: string; detail: string };

/** Where generated crews/workflows are written + how their registries are found. */
export type CrewWritePaths = {
  crewsDir: string;
  crewsIndexPath: string;
  workflowsDir: string;
  workflowsIndexPath: string;
};

/** Optional verify-then-commit bundle — mirrors agent-builder's
 *  `BuilderVerifyDeps`. Undefined ⇒ `buildCrewOrWorkflow` keeps the OLD
 *  behavior (write straight to the registry on consent). Present ⇒ it runs
 *  reuse-check → generate → consent → auto-build members → stage → verify →
 *  commit (see `src/verified-build/gate.ts`). Unlike the agent-builder's
 *  bundle there is no `dir` field: the manifest/golden sidecar directory
 *  depends on the classified shape (crews vs workflows), so the builder
 *  resolves it per-call from `CrewBuilderDeps.paths`. */
export type CrewBuilderVerifyDeps = {
  embed: (t: string[]) => Promise<number[][]>;
  judgeCandidates: () => { model: string; params: number; family: string }[];
  /** Wraps `runCrew`/`runWorkflow` — runs a (not-yet-registered) crew/workflow
   *  def against one task, dispatching on `shape`. */
  runArtifact: (
    def: unknown,
    shape: Shape,
    task: string,
  ) => Promise<{ text: string } | { error: string }>;
  /** One yes/no judge call for a single rubric prompt. */
  judge: (prompt: string) => Promise<boolean>;
  generatorFamily?: string;
  /** Downgrade a failing gate to an Unverified commit instead of aborting. */
  force?: boolean;
};

export type CrewBuilderDeps = {
  model: BuilderModel;
  existingAgents: () => string[]; // agentNames()
  packNames: () => string[]; // STARTER_PACK names
  existingCrews: () => string[]; // Object.keys(CREWS)
  existingWorkflows: () => string[]; // Object.keys(WORKFLOWS)
  confirm: (proposalText: string) => Promise<boolean>;
  /** Auto-build a missing agent for a needed capability; returns built agent name or null on decline/failure. */
  buildMissingAgent: (need: string) => Promise<string | null>;
  paths: CrewWritePaths;
  agentPaths: WritePaths; // passed through to buildMissingAgent's deps
  log?: (m: string) => void;
  verify?: CrewBuilderVerifyDeps;
};

export type { BuilderDeps, CrewIR, ValidationIssue, WorkflowIR };
