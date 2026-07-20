/**
 * Per-type trigger config parsing + create-time validation (Slice 25,
 * Task 23).
 *
 * `TriggerCreateRequestSchema`/`TriggerPatchRequestSchema` keep `config` as
 * `z.unknown()` on the wire — its shape depends on the sibling `type` field —
 * so THIS is where the matching per-type schema (`CronConfigSchema` /
 * `WebhookConfigSchema` / `FileConfigSchema` / `JobChainConfigSchema`,
 * `src/contracts/requests.ts`) is picked and applied. `TriggerConfig` is a
 * NON-discriminated union (no shared literal tag across its four members), so
 * dispatch is EXPLICIT on the caller-supplied `type` — never inferred from the
 * shape of `raw` — matching the T1 carry.
 *
 * Two extra checks ride along with the per-type parse:
 *  - cron: `validateCron(schedule, timezone)` — a syntactically-valid-JSON but
 *    unparseable cron PATTERN throws here (mapped to 400 by the caller), never
 *    surfacing later at scheduler-tick time.
 *  - file: `confineWatchPath(path, expandHome(AGENT_TRIGGERS_WATCH_ROOT))` —
 *    the SAME expanded root the watcher re-confines against at watch-start
 *    (`triggers/watcher.ts`), so a path accepted HERE can never be rejected
 *    THERE (§7.4 defense-in-depth — not a second, independently-configured
 *    root). The confined (realpath'd) result is discarded: only the
 *    confinement check's pass/fail matters here — the STORED config keeps the
 *    caller's original (possibly `~`/not-yet-existing) `path`, exactly what
 *    the watcher re-resolves at watch-start.
 *
 * Throws on any invalid config — a `ZodError` from a per-type schema, a plain
 * `Error` for a bad cron pattern, or `WatchPathError` for an escaping file
 * path. Callers (create.ts) wrap the whole call in one try/catch and map ANY
 * throw to 400.
 */

import { loadConfig } from '../../config/schema.ts';
import {
  CronConfigSchema,
  FileConfigSchema,
  JobChainConfigSchema,
  TriggerTypeWire,
  WebhookConfigSchema,
} from '../../contracts/index.ts';
import { confineWatchPath, expandHome } from '../../triggers/confine.ts';
import { validateCron } from '../../triggers/next-run.ts';
import type { TriggerConfig } from '../../triggers/types.ts';

export function parseTriggerConfig(
  type: TriggerTypeWire,
  raw: unknown,
): TriggerConfig {
  switch (type) {
    case TriggerTypeWire.Cron: {
      const cfg = CronConfigSchema.parse(raw);
      if (!validateCron(cfg.schedule, cfg.timezone)) {
        throw new Error(`invalid cron pattern: ${cfg.schedule}`);
      }
      return cfg;
    }
    case TriggerTypeWire.Webhook:
      return WebhookConfigSchema.parse(raw);
    case TriggerTypeWire.File: {
      const cfg = FileConfigSchema.parse(raw);
      const root = expandHome(
        loadConfig().values.AGENT_TRIGGERS_WATCH_ROOT as string,
      );
      // Throws WatchPathError on an escaping/symlink-escaping/fs-root path.
      confineWatchPath(cfg.path, root);
      // FileConfigSchema/FileConfig (wire) <-> FileConfig (domain) are
      // isomorphic (events: string-literal union <-> FileEventKind string
      // enum, guarded by trigger-enum-parity.test.ts) — same cast idiom as
      // `enqueue.ts`'s `body.kind as unknown as JobKind`.
      return cfg as unknown as TriggerConfig;
    }
    case TriggerTypeWire.JobChain: {
      const cfg = JobChainConfigSchema.parse(raw);
      // onKind: JobKindWire <-> JobKind, onStatus: literal <-> JobStatus —
      // both isomorphic string enums; same cast idiom as above.
      return cfg as unknown as TriggerConfig;
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`unknown trigger type: ${String(exhaustive)}`);
    }
  }
}
