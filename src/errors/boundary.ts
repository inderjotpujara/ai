/**
 * Top-level error boundary — maps typed framework errors to actionable
 * user-facing messages and persists an `error.json` per run.
 *
 * Consumed by `cli/chat.ts`'s `main().catch(...)` in place of a bare
 * `console.error` so a run's failure is both explained to the user and
 * recorded next to the run's other artifacts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CrewError,
  MaxStepsError,
  MemoryError,
  ProviderError,
  ResourceError,
  ToolError,
  VerificationError,
  WorkflowError,
} from '../core/errors.ts';

/** An actionable title + hint pair for a caught error. */
export type Explanation = { title: string; hint: string };

/** Injectable side effects for `handleTopLevel`, so it is unit-testable. */
export type HandleTopLevelDeps = {
  runDir?: string;
  write?: (path: string, data: string) => void;
  log?: (s: string) => void;
};

/** Maps a `FrameworkError` subclass to an actionable title+hint; unknown errors get a generic pair. */
export function explain(err: unknown): Explanation {
  if (err instanceof ResourceError) {
    return {
      title: 'No model fits the memory budget',
      hint: 'Free memory, pick a smaller model, or run `bun run provision`.',
    };
  }
  if (err instanceof ProviderError) {
    return {
      title: 'A model provider/runtime failed',
      hint: 'Check the provider (e.g. Ollama running: `bun run status`).',
    };
  }
  if (err instanceof ToolError) {
    return {
      title: 'A tool failed',
      hint: 'Check the tool/MCP server; see the run trace with `bun run runs`.',
    };
  }
  if (err instanceof MemoryError) {
    return {
      title: 'A memory/RAG error',
      hint: 'Check the space/embedder; a reindex may be required.',
    };
  }
  if (err instanceof VerificationError) {
    return {
      title: 'Verification was misused',
      hint: 'Ensure a memory store is configured for --verify.',
    };
  }
  if (err instanceof WorkflowError || err instanceof CrewError) {
    return {
      title: 'A workflow/crew error',
      hint: 'Inspect the failing step with `bun run runs`.',
    };
  }
  if (err instanceof MaxStepsError) {
    return {
      title: 'The agent hit its step ceiling',
      hint: 'The task may need a crew/workflow, or a higher step budget.',
    };
  }
  return {
    title: 'Unexpected error',
    hint: 'See the stack below; re-run with AGENT_LOG_LEVEL=debug for detail.',
  };
}

/**
 * Logs the explained error and best-effort persists `error.json` to
 * `deps.runDir` if provided. Always returns exit code `1`; never throws.
 */
export function handleTopLevel(
  err: unknown,
  deps: HandleTopLevelDeps = {},
): number {
  const write = deps.write ?? ((p, d) => writeFileSync(p, d));
  const log = deps.log ?? ((s) => process.stderr.write(`${s}\n`));
  const { title, hint } = explain(err);
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  log(`✖ ${title}: ${message}\n  → ${hint}`);
  if (deps.runDir) {
    try {
      write(
        join(deps.runDir, 'error.json'),
        JSON.stringify(
          { name, title, message, hint, at: new Date().toISOString() },
          null,
          2,
        ),
      );
    } catch {
      /* best-effort */
    }
  }
  return 1;
}
