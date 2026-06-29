/** Base for all framework errors; sets `name` to the concrete class name. */
class FrameworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A model provider/runtime failed (e.g. Ollama unreachable). */
export class ProviderError extends FrameworkError {}

/** A tool failed in a way the loop could not recover from. */
export class ToolError extends FrameworkError {}

/** The agent loop hit its step ceiling without finishing. */
export class MaxStepsError extends FrameworkError {}

/** A model cannot fit the machine's memory budget. */
export class ResourceError extends FrameworkError {}

/** A delegated sub-agent run failed irrecoverably. */
export class DelegationError extends FrameworkError {}
