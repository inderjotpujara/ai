/**
 * A2A least-privilege skill allowlist (Slice 31, §7.4) — THE security boundary
 * for which registered agents/crews/workflows are exposed as A2A skills. There
 * is NO "run anything" free-form entry and NO path to expose an unregistered
 * ref: `put` validates author-time that the ref resolves to a REGISTERED
 * agent/crew/workflow for its kind (`refExistsFor`) and throws otherwise, and
 * `resolve` returns `undefined` (never a default/fall-through target) for an
 * unlisted skillId — the server resolves-then-rejects.
 *
 * Persistence mirrors `server/security/device-registry.ts` byte-for-byte:
 * `0700` dir / `0600` file, atomic temp+rename writes, and a FAIL-CLOSED load
 * (a present-but-unparseable store THROWS — silently collapsing a tampered
 * allowlist to "no skills" would be a security-relevant loss, so we refuse to
 * start rather than serve an unknown exposure surface).
 */

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { AGENTS } from '../../agents/index.ts';
import { getCrew } from '../../crews/index.ts';
import { getWorkflow } from '../../workflows/index.ts';
import { loadConfig } from '../config/schema.ts';
import { JobKind } from '../queue/types.ts';

/** A single exposed skill → its registered enqueue target. */
export type SkillEntry = {
  skillId: string;
  name: string;
  description: string;
  kind: JobKind; // Chat | Crew | Workflow — the enqueue target kind
  ref: string; // registered agent name (AGENTS) | crew name | workflow name
};

/** What `resolve` hands back to the server for a listed skill. */
export type ResolvedTarget = { kind: JobKind; ref: string };

export type A2aAllowlist = {
  list(): SkillEntry[];
  /** Author-time validation: the ref MUST resolve to a REGISTERED agent/crew/
   *  workflow for its kind, else throw `AllowlistError`. NEVER a "run anything"
   *  entry (§7.4). */
  put(entry: SkillEntry): void;
  remove(skillId: string): void;
  /** Invoke-time re-check: resolve a presented skillId to its target, or
   *  `undefined` if unlisted (server resolves-then-rejects — never a
   *  fall-through to a generic orchestrator run, §7.4). */
  resolve(skillId: string): ResolvedTarget | undefined;
};

/** Thrown when `put` is asked to expose a ref that maps to no registered
 *  agent/crew/workflow — the author-time least-privilege guard (§7.4). */
export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowlistError';
  }
}

/**
 * Does `ref` name a REGISTERED target for `kind`? This is the least-privilege
 * check: only names present in the in-process registries are exposable.
 * - `Workflow` → a registered workflow.
 * - `Crew`     → a registered crew.
 * - `Chat`     → a registered agent OR a registered crew (the launch surface
 *   lets a chat target either).
 * `AGENTS` is a bare `Record`, so `Object.hasOwn` (not `!!AGENTS[ref]`) is used
 * to avoid `constructor`/`__proto__`/`toString` resolving to inherited members
 * and slipping an unregistered ref past the guard; `getCrew`/`getWorkflow`
 * already apply the same `Object.hasOwn` discipline.
 */
export function refExistsFor(kind: JobKind, ref: string): boolean {
  if (kind === JobKind.Workflow) return getWorkflow(ref) !== undefined;
  if (kind === JobKind.Crew) return getCrew(ref) !== undefined;
  return Object.hasOwn(AGENTS, ref) || getCrew(ref) !== undefined;
}

export function createA2aAllowlist(config: { path?: string }): A2aAllowlist {
  const path = config.path ?? String(loadConfig().values.AGENT_A2A_SKILLS_PATH);
  let skills: SkillEntry[] = load(path);

  // Atomic write: serialize to a unique temp file in the SAME dir, then rename
  // over the target (rename is atomic within a filesystem), so a crash mid-write
  // can never leave a half-written / truncated store. The temp file is minted
  // 0600 up front so the security-relevant data is never briefly world-readable.
  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ skills }), { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup; surface the original failure below
      }
      throw err;
    }
  }

  return {
    list(): SkillEntry[] {
      return [...skills];
    },
    put(entry: SkillEntry): void {
      if (!refExistsFor(entry.kind, entry.ref)) {
        throw new AllowlistError(
          `Cannot expose A2A skill '${entry.skillId}': ref '${entry.ref}' is ` +
            `not a registered ${entry.kind} target (§7.4 least-privilege — no ` +
            `"run anything" exposure).`,
        );
      }
      // Field-strip to exactly the five persisted fields (defense-in-depth):
      // the type forbids extras at compile time only — an `as any`/spread caller
      // could otherwise smuggle a property onto disk. Upsert on skillId.
      const clean: SkillEntry = {
        skillId: entry.skillId,
        name: entry.name,
        description: entry.description,
        kind: entry.kind,
        ref: entry.ref,
      };
      skills = [...skills.filter((s) => s.skillId !== clean.skillId), clean];
      persist();
    },
    remove(skillId: string): void {
      skills = skills.filter((s) => s.skillId !== skillId);
      persist();
    },
    resolve(skillId: string): ResolvedTarget | undefined {
      // Invoke-time re-read from disk so a revoked/edited allowlist takes effect
      // without a restart. Returns undefined for an unlisted id — NEVER a
      // default target (§7.4: the server resolves-then-rejects).
      const current = load(path);
      const hit = current.find((s) => s.skillId === skillId);
      return hit ? { kind: hit.kind, ref: hit.ref } : undefined;
    },
  };
}

/**
 * Load the store. An ABSENT file is a legitimate "nothing exposed yet" → `[]`.
 * A PRESENT-but-corrupt file (unparseable JSON, or not the `{ skills: [] }`
 * shape) THROWS — fail closed: silently collapsing a tampered/unreadable
 * allowlist to "no skills" would drop the exposure record and mask tampering.
 * Mirrors `load` in `server/security/device-registry.ts`.
 */
function load(path: string): SkillEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `A2A skill allowlist at ${path} exists but is not valid JSON — refusing ` +
        `to start with an unreadable exposure store (fail closed): ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { skills?: unknown }).skills)
  ) {
    throw new Error(
      `A2A skill allowlist at ${path} exists but is not a { skills: [] } ` +
        `object — refusing to start with an unreadable exposure store (fail closed).`,
    );
  }
  return (parsed as { skills: unknown[] }).skills
    .filter(
      (s): s is SkillEntry =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as SkillEntry).skillId === 'string' &&
        typeof (s as SkillEntry).name === 'string' &&
        typeof (s as SkillEntry).description === 'string' &&
        typeof (s as SkillEntry).kind === 'string' &&
        typeof (s as SkillEntry).ref === 'string',
    )
    .map(
      (s): SkillEntry => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        kind: s.kind,
        ref: s.ref,
      }),
    );
}
