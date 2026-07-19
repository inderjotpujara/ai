import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StatusEventType } from '../../contracts/enums.ts';
import type { EventSink } from '../../core/events.ts';
import type { ConfirmAsk, ConfirmPort, ConsentRegistry } from './registry.ts';

type PromptRec = {
  ask: ConfirmAsk;
  runId?: string;
  answer?: unknown;
  settled: boolean;
};
type Store = Record<string, PromptRec>;

/**
 * The durable {@link ConsentRegistry}: the SAME `port`/`resolve`/`pending` port
 * as the in-memory `createConsentRegistry`, but backed by a `0600` JSON file
 * keyed by `promptId`, so a prompt awaiting an answer SURVIVES a daemon restart
 * (the in-memory `Map` at `registry.ts:31` is lost on crash today — item 1). On
 * boot, a fresh registry over the same file reloads the still-pending prompts,
 * so `POST /api/runs/:id/respond` can still resolve them after a restart. The
 * live in-process awaiter Promise cannot survive a restart (a Promise is not
 * serialisable) — but the durable RECORD does, so the answer settles the record
 * and any re-attached awaiter, and a resumed run can re-enter its awaiting state
 * rather than failing outright.
 */
export function createDurableConsentRegistry(config: {
  path?: string;
  runId?: string;
}): ConsentRegistry {
  const path = config.path ?? 'runs/_consent/consent.json';
  const store: Store = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Store)
    : {};
  const resolvers = new Map<string, (v: unknown) => void>();

  function persist(): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store), { mode: 0o600 });
  }

  const port: ConfirmPort = (ask: ConfirmAsk, emit: EventSink) => {
    const promptId = randomBytes(32).toString('hex');
    store[promptId] = { ask, runId: config.runId, settled: false };
    persist(); // durable BEFORE emit, so a crash between the two never loses it
    return new Promise<unknown>((resolve) => {
      resolvers.set(promptId, resolve);
      emit({
        type: StatusEventType.Confirm,
        promptId,
        kind: ask.kind,
        question: ask.question,
      });
    });
  };

  const resolve = (promptId: string, value: unknown): boolean => {
    const rec = store[promptId];
    if (!rec || rec.settled) return false; // unknown OR already-settled
    rec.settled = true;
    rec.answer = value;
    persist();
    resolvers.get(promptId)?.(value); // settle the in-memory awaiter if present
    resolvers.delete(promptId);
    return true;
  };

  const pending = (): string[] =>
    Object.keys(store).filter((id) => !store[id]?.settled);

  return { port, resolve, pending };
}
