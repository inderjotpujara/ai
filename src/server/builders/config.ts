const DEFAULT_CONFIRM_WAIT_MS = 15 * 60_000; // 15 minutes — a HUMAN decision window

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

/** Wall-clock cap around a builder's confirm/confirmReuse await (§7.1): an
 *  abandoned wizard (the human never answers — closes the tab mid-consent)
 *  must not suspend `execute`, and thus the terminal result, forever.
 *  Deliberately its OWN, much longer budget than `dryRunMs()`
 *  (`src/verified-build/config.ts`, a MODEL-call timeout) — this bounds how
 *  long the server waits for a HUMAN click, not a generateText call. */
export function confirmWaitMs(): number {
  return envNumber('AGENT_BUILDER_CONFIRM_WAIT_MS', DEFAULT_CONFIRM_WAIT_MS);
}
