import type { ResourceError } from './errors.ts';

/**
 * Shared seam between the delegation hook and the orchestrator. onBeforeDelegate
 * records a genuine resource failure here (the AI SDK would otherwise swallow a
 * thrown ResourceError into a soft tool-result); runOrchestrator reads it and
 * surfaces a hard {kind:'resource'} result instead of a hallucinated answer.
 */
export type ResourceCapture = { error?: ResourceError };
