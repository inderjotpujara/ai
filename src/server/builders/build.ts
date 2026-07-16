import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { BuildResultDTO } from '../../contracts/dto.ts';
import { type BuilderKind, StatusEventType } from '../../contracts/enums.ts';
import { BuilderBuildRequestSchema } from '../../contracts/requests.ts';
import type { EventSink } from '../../core/events.ts';
import { withWallClock } from '../../reliability/timeout.ts';
import { newRunId } from '../../run/run-id.ts';
import type { ConsentRegistry } from '../consent/registry.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import {
  confirmReuseViaPort,
  confirmViaPort,
  logToTextDelta,
} from './adapter.ts';
import { confirmWaitMs } from './config.ts';

/** What one builder run needs to do the actual generate/consent/verify/commit
 *  work (Task 12's `createRealRunBuilderTurn` composes `buildAgent`/
 *  `buildCrewOrWorkflow` under `withRunTelemetry`). Kept UNIT-TESTABLE here —
 *  the real turn is covered by live-verify, not unit tests, same policy as
 *  `RunCrewTurn`/`RunChatTurn` (Phase 4/2). */
export type RunBuilderTurn = (input: {
  kind: BuilderKind;
  need: string;
  autoYes?: boolean;
  force?: boolean;
  runId: string;
  confirm: (question: string) => Promise<boolean>;
  confirmReuse: (kind: string, question: string) => Promise<boolean>;
  log: (m: string) => void;
}) => Promise<BuildResultDTO>;

export type BuilderBuildDeps = {
  runsRoot: string;
  consent: ConsentRegistry;
  runBuilderTurn: RunBuilderTurn;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Wraps a boolean ask with `confirmWaitMs()`'s wall-clock cap (§7.1
 *  requirement (b)): a timeout is treated as a DECLINE — fail-closed, never
 *  an auto-approve. The registry's own `pendingResolvers` entry for this
 *  promptId is not proactively evicted on timeout (accepted for this phase —
 *  a late answer simply lands on nobody listening; a registry-level expiry
 *  is a natural future hardening item, not required here). */
function withConfirmTimeout(ask: () => Promise<boolean>): Promise<boolean> {
  return withWallClock(confirmWaitMs(), ask).catch(() => false);
}

/**
 * `POST /api/builders/build` (spec §4.2.1/§7.1) — streams the guided-build
 * flow as an AI-SDK SSE UI-message stream, exactly `handleChat`'s shape.
 * Mints a runId, emits `data-run-start`/`data-run-end`, and dispatches to
 * `deps.runBuilderTurn` with `confirm`/`confirmReuse`/`log` bridged onto the
 * SAME connection's event sink + text-delta parts (Task 9's adapters, D4).
 *
 * `execute` is NOT detached (unlike the fire-and-watch model-pull route,
 * Task 17): the whole build runs to completion inside it, so a client abort
 * (`req.signal`) never tears the build down mid-stage — requirement (d). The
 * terminal `BuildResultDTO` is written EXACTLY ONCE, as a one-shot
 * `data-build-result` data part, whether `runBuilderTurn` resolves OR throws
 * (requirement (c)) — the §4.2.1 "one-shot data/text part". A DATA part (not a
 * `text-delta` carrying `JSON.stringify`) so the DTO rides the wire as
 * structured JSON the T13 fold reads straight off `part.data`, rather than
 * re-parsing it out of an escaped text blob — mirroring `handleChat`'s
 * one-shot-outcome discipline for a non-'answer' result while keeping the
 * payload machine-readable.
 */
export async function handleBuilderBuild(
  req: Request,
  deps: BuilderBuildDeps,
): Promise<Response> {
  let body: ReturnType<typeof BuilderBuildRequestSchema.parse>;
  try {
    body = BuilderBuildRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid builder request' }, 400);
  }

  const runId = newRunId();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const events: EventSink = (e) =>
        writer.write({ type: e.type, data: e, transient: true });
      const log = logToTextDelta(writer.write);
      const confirmRaw = confirmViaPort(deps.consent.port, events, 'build');
      const confirm = (question: string) =>
        withConfirmTimeout(() => confirmRaw(question));
      const confirmReuseRaw = confirmReuseViaPort(deps.consent.port, events);
      const confirmReuse = (kind: string, question: string) =>
        withConfirmTimeout(() => confirmReuseRaw(kind, question));

      events({ type: StatusEventType.RunStart, runId, task: body.need });

      let result: BuildResultDTO;
      try {
        result = await deps.runBuilderTurn({
          kind: body.kind,
          need: body.need,
          autoYes: body.autoYes,
          force: body.force,
          runId,
          confirm,
          confirmReuse,
          log,
        });
      } catch (err) {
        result = {
          kind: 'failed-verification',
          stage: 'error',
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      writer.write({ type: 'data-build-result', data: result });

      events({ type: StatusEventType.RunEnd, runId, outcome: result.kind });
    },
    onError: (err) =>
      `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
