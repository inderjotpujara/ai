/**
 * Every finite named value on the web wire. Isomorphic: this file imports
 * nothing (not even zod). Enums (not string-literal unions) per repo style;
 * discriminated unions elsewhere take their discriminant from `StatusEventType`.
 */

/** Run provenance (reserved; Slice 25 sets the non-`manual` values). */
export enum RunOrigin {
  Manual = 'manual',
  Schedule = 'schedule',
  Webhook = 'webhook',
  Api = 'api',
  Remote = 'remote',
}

/** Run lifecycle — not just terminal outcome (Slices 24/25/34/38 use the rest). */
export enum RunLifecycle {
  Queued = 'queued',
  Running = 'running',
  PausedAwaitingInput = 'paused-awaiting-input',
  Done = 'done',
  Failed = 'failed',
  Resumable = 'resumable',
}

export enum SpanStatus {
  Ok = 'ok',
  Error = 'error',
}

/** Run-artifact classification (mapper-side readdir+classify; Slice 30b Phase 3). */
export enum ArtifactKind {
  Answer = 'answer',
  Gap = 'gap',
  Spans = 'spans',
  Degradation = 'degradation',
  Other = 'other',
  Result = 'result',
  Resource = 'resource',
  Unverified = 'unverified',
  Failed = 'failed',
  Error = 'error',
  Media = 'media',
}

/**
 * Wire mirror of `src/reliability/ledger.ts` DegradeKind. The contract MUST NOT
 * import reliability (isomorphic rule), so we redeclare the identical string
 * values here; `tests/contracts/degrade-kind-parity.test.ts` guards they stay equal.
 */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export enum ChatRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

/** Thumbs feedback on a chat message (Slice 30b Phase 2; Slice 31 consumes it). */
export enum FeedbackRating {
  Up = 'up',
  Down = 'down',
}

/** Model-lifecycle transition carried by `data-model-load`. */
export enum ModelLoadAction {
  Pull = 'pull',
  Evict = 'evict',
  Warm = 'warm',
}

/** Transient SSE data-part discriminants (also the AI-SDK data-part type names). */
export enum StatusEventType {
  RunStart = 'data-run-start',
  Provision = 'data-provision',
  McpMount = 'data-mcp-mount',
  Delegation = 'data-delegation',
  ModelSelect = 'data-model-select',
  ModelLoad = 'data-model-load',
  Degrade = 'data-degrade',
  Confirm = 'data-confirm',
  RunEnd = 'data-run-end',
}

/** Wire mirror of `src/workflow/types.ts` StepKind (isomorphic rule — no engine
 *  import). `tests/contracts/step-kind-parity.test.ts` guards value parity. */
export enum StepKind {
  Agent = 'agent',
  Tool = 'tool',
  Branch = 'branch',
  Map = 'map',
  Verify = 'verify',
}

/** Wire mirror of `src/crew/types.ts` CrewProcess (isomorphic rule).
 *  `tests/contracts/crew-process-parity.test.ts` guards value parity. */
export enum CrewProcess {
  Sequential = 'sequential',
  Hierarchical = 'hierarchical',
}

/** What a run IS (chat/agent/crew/workflow/build/pull), derived by the mapper
 *  from the run's root span name. Distinct from RunOrigin (HOW a run was
 *  triggered). Build/Pull added Slice 30b Phase 5 — contract-owned, no engine
 *  mirror needed (see `deriveRunKind`, Task 2). */
export enum RunKind {
  Chat = 'chat',
  Agent = 'agent',
  Crew = 'crew',
  Workflow = 'workflow',
  Build = 'build',
  Pull = 'pull',
}

/** Wire mirror of `src/verified-build/types.ts` VerifiedLevel (isomorphic
 *  rule — no engine import). `tests/contracts/verified-level-parity.test.ts`
 *  guards value parity. Slice 30b Phase 5. */
export enum VerifiedLevel {
  Behaves = 'behaves',
  Runs = 'runs',
  Unverified = 'unverified',
}

/** Wire mirror of `src/verified-build/types.ts` ReuseKind (isomorphic rule).
 *  Also doubles as the `data-confirm` event's `kind` value for a reuse-offer
 *  ask (D4). `tests/contracts/reuse-kind-parity.test.ts` guards value parity.
 *  Slice 30b Phase 5. */
export enum ReuseKind {
  Reuse = 'reuse',
  Offer = 'offer',
  Generate = 'generate',
}
