import { CONFIG_SPEC, loadConfig } from '../config/schema.ts';

/** `bun run config` — prints every documented AGENT_* knob, its effective
 *  value (env override or default) and source, one line each. */
function main(): void {
  const { values, sources } = loadConfig();
  for (const e of CONFIG_SPEC) {
    const src = sources[e.env] === 'env' ? 'env ' : 'def ';
    process.stdout.write(
      `${src} ${e.env.padEnd(32)} ${String(values[e.env]).padEnd(12)} ${e.doc}\n`,
    );
  }
}

if (import.meta.main) main();
