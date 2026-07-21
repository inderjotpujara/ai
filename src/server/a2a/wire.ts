/**
 * `buildA2aServerDeps` — the SINGLE constructor for the A2A EXPOSE-surface
 * deps object (`ServerDeps.a2a`), shared by the daemon/standalone boot
 * (`server/main.ts`) and the CLI (Task 27) so neither hand-rolls the shape.
 *
 * It mirrors how the Slice-25 triggers engine is built in one place and
 * injected — but the A2A stores are file-backed (allowlist + enrollment
 * registry) plus an in-memory task index with NO start/stop lifecycle, so this
 * is a PURE deps handoff: there is no drain, no producer-ordering, and no
 * double-instantiation hazard to guard (unlike the pool/triggers engine).
 *
 * The caller gates the call on `AGENT_A2A_ENABLED`, so with the flag off
 * `deps.a2a` stays `undefined` and both the card route and `POST /api/a2a`
 * report unavailable — the expose surface advertises nothing until an operator
 * turns it on (the fail-safe default).
 *
 * Increment 6 (Task 20/22) extends this with the CONSUME side (`remotes` +
 * `client`); those factories do not exist yet, so this Increment-5 constructor
 * builds only the EXPOSE-complete fields.
 */

import { createA2aAllowlist } from '../../a2a/allowlist.ts';
import { createA2aEnrollment } from '../../a2a/enroll.ts';
import type { A2aServerDeps } from '../../a2a/server.ts';
import { createTaskIndex } from '../../a2a/task-index.ts';
import type { loadConfig } from '../../config/schema.ts';
import type { JobStore } from '../../queue/store.ts';
import type { RootTokenStore } from '../security/root-token.ts';

export function buildA2aServerDeps(
  cfg: ReturnType<typeof loadConfig>['values'],
  ctx: { jobStore: JobStore; runsRoot: string; rootTokens: RootTokenStore },
): A2aServerDeps {
  // The allowlist and issued-token registry share ONE store path
  // (`AGENT_A2A_SKILLS_PATH`, mirroring `AGENT_QUEUE_PATH`).
  const skillsPath = String(cfg.AGENT_A2A_SKILLS_PATH);
  return {
    allowlist: createA2aAllowlist({ path: skillsPath }),
    // Enrollment resolves the root PER CALL through the SAME `rootStore` the
    // session guard verifies against (passed as `ctx.rootTokens`), so a
    // rotate-root invalidates every outstanding A2A Bearer at once.
    enrollment: createA2aEnrollment({
      rootTokens: ctx.rootTokens,
      registryPath: skillsPath,
    }),
    jobStore: ctx.jobStore,
    runsRoot: ctx.runsRoot,
    taskIndex: createTaskIndex(),
    // Task 20/22 (Increment 6): add remotes + client (CONSUME side).
  };
}
