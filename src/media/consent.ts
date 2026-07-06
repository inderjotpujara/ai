import {
  askYesNo,
  interactiveTTY,
  stdinInput,
} from '../provisioning/ui/prompt.ts';

/** Labels the active content policy for telemetry/output — 'uncensored' when
 *  the uncensored axis is enabled (the default), 'default' otherwise. This is
 *  observability only: it never gates generation, it just makes the setting
 *  that produced a given run/output legible after the fact. */
export function contentPolicyLabel(uncensored: boolean): string {
  return uncensored ? 'uncensored' : 'default';
}

/** Voice-cloning model families: CSM, Dia, XTTS, Fish. Matched case-
 *  insensitively as a substring anywhere in the model id/name so both bare
 *  names ("csm") and repo-qualified ids ("suno/csm-1b") match. Kokoro (the
 *  default TTS engine) is intentionally excluded — it ships fixed preset
 *  voices only and has no cloning capability, so it needs no consent gate. */
const CLONE_MODEL_PATTERN = /(csm|dia|xtts|fish)/i;

/** True when `model` is a voice-cloning model that requires the affirmative
 *  consent gate below before it may run. This is orthogonal to the
 *  content-policy switch (`uncensoredEnabled`) — it's about voice
 *  identity/impersonation, not generated content, so it applies regardless
 *  of whether uncensored mode is on or off. */
export function requiresCloneConsent(model: string): boolean {
  return CLONE_MODEL_PATTERN.test(model);
}

/** Legal note surfaced at pull/label time. This is a STRING CONSTANT, not a
 *  gate, classifier, or refusal path: removing content filters removes the
 *  in-product friction, not the law. CSAM and non-consensual intimate
 *  imagery (NCII) remain illegal to generate or distribute regardless of any
 *  setting in this framework. */
export const LEGAL_NOTE =
  'Removing content filters does not remove legal obligations: generating or ' +
  'distributing CSAM or non-consensual intimate imagery (NCII) remains ' +
  'illegal regardless of these settings. You are responsible for how you use ' +
  'this capability.';

/** Asks the user to affirm they have the right to, and consent to, clone the
 *  voice a cloning-capable TTS model is about to reproduce. `deps.ask` is
 *  injected so callers can supply a real TTY prompt (see
 *  `defaultCloneConsentAsk`) or a scripted answer in tests. */
export async function affirmCloneConsent(deps: {
  ask: (question: string) => Promise<boolean>;
}): Promise<boolean> {
  return deps.ask(
    'This voice model can clone a specific person’s voice. Do you have ' +
      'the right to, and consent to, clone this voice?',
  );
}

/** Default `ask` for `affirmCloneConsent`: a real TTY yes/no prompt, mirroring
 *  the provisioning consent gate (`askYesNo` + `stdinInput`, stderr-only, no
 *  `console.log`). Never auto-yes — voice-clone consent is always asked.
 *
 *  Gated on `interactiveTTY()` first, exactly like every other prompt call
 *  site in this repo (`src/mcp/mount.ts`, `src/cli/chat.ts`,
 *  `maybeAutoProvision`): when stdin/stderr aren't both TTYs (daemon, MCP
 *  tool call, remote invocation), there is no human to answer, so consent
 *  fails safe — DECLINED — instead of hanging the process on a read from a
 *  pipe that will never produce a line. */
export function defaultCloneConsentAsk(): (
  question: string,
) => Promise<boolean> {
  const input = stdinInput();
  return async (question: string) => {
    if (!interactiveTTY()) return false;
    return askYesNo(question, { input, autoYes: false });
  };
}
