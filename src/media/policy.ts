import { ContentPolicy } from '../core/types.ts';

/**
 * Determine if uncensored models are enabled.
 * DEFAULT: true (uncensored is ON by default)
 * Only returns false when env.AGENT_UNCENSORED is exactly '0' or 'false' (case-insensitive).
 * Any other value (unset, '1', 'true', anything else) returns true.
 */
export function uncensoredEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.AGENT_UNCENSORED;
  if (value === undefined) return true;
  if (value === '0') return false;
  if (value.toLowerCase() === 'false') return false;
  return true;
}

/**
 * Determine if a model qualifies as uncensored based on its content policy or name patterns.
 * Returns true if:
 * - model.contentPolicy === ContentPolicy.Uncensored, OR
 * - model.model matches the uncensored model name pattern (case-insensitive)
 */
export function isUncensoredModel(model: {
  model: string;
  contentPolicy?: ContentPolicy;
}): boolean {
  // Check explicit contentPolicy tag
  if (model.contentPolicy === ContentPolicy.Uncensored) return true;

  // Check if model name matches the uncensored class pattern
  const uncensoredPattern =
    /(abliterat|dolphin|heretic|josiefied|pony|chroma|uncensored)/i;
  return uncensoredPattern.test(model.model);
}
